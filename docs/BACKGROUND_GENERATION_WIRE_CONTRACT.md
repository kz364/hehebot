# Background generation wire contract (Stage B)

**Status: REVIEWED FOR LOCAL IMPLEMENTATION, NOT IMPLEMENTED.** This document specifies a new
default-off, versioned, finite restricted-background generation. It changes no
code. Parent review clears the credential-free control-plane implementation only;
runtime/native integration and live acceptance remain separate gates. Nothing here
claims completion of any S/O/UX acceptance ID.

Parent review addendum (2026-09-20): claim-time context must use the restricted
snapshot below, frozen status bytes must be stored and verified, and receipt
thread IDs are host assertions rather than independently authenticated Worker
observations. These clarifications supersede revision-2 source-equivalence claims.

Revision 2 (parent correction pass): resolves parent questions Q1–Q6
conservatively; requires default-denied mutations/effects; restructures
first-admission predicates to distinguish pre-admission custody checks from
post-transaction launch envelope predicates (per
`OwnerAlphaWarm.assertMessageAdmission`/`assignNewMessage` in
src/core/owner-alpha-warm.ts); replaces invented payload shapes with the
actual `SCHEMAS/runtime.json` envelopes (one new optional field only); returns
the full durable run row in the claim envelope; corrects the Stage A
configuration environment name to `HEHEBOT_OWNER_ALPHA_WARM_GENERATION`; and
softens the descendant-settlement wording. A change log is in §16.

It follows the structure of `docs/WARM_GENERATION_WIRE_CONTRACT.md` (Stage A),
extends the recorded V2 native evidence (`docs/OWNER_BACKGROUND_V2_NATIVE.md`,
`docs/NATIVE_ORCHESTRATION.md`), and never rewrites or upgrades Stage A, legacy
bootstrap, or historical grant rows.

## 0. Scope, non-goals, settled constraints

In scope: one default-off, versioned, finite background generation —
`owner-alpha-background-generation-v1` — admitting exactly **three** logical
roots in one pinned Codex `0.154.0` app-server process under one managed-auth
owner, one installation, one Durable Object, one Sprite, one executor, one
provider-activity owner and one lock owner:

| Admission | Role | Kind | Native profile |
| --- | --- | --- | --- |
| 1 | `background` (A) | background root | full restricted V2 profile (below) |
| 2 | `status` (S) | independent root | restricted plain profile, no MCP, frozen durable status summary as context |
| 3 | `independent` (B) | independent root | restricted plain profile, read-only MCP, root-only |

Only A may spawn native descendants. A's descendants may share A's logical task
grant (task-level provenance only). S and B never do. Only A may use the
existing restricted V2 collaboration profile (cap 2 including root, wait agent
off, `multi_agent_v1` off, plus every tested restriction from
`scripts/test-codex-owner-background-v2.mjs`). S is admitted only after a
trusted A coordinator-release is durably observed, while A's child may remain
active; B is admitted only after S settles. B is root-only — it is not a second
background tree.

Roles are assigned by admission ordinal inside the generation, never inferred
from message text. This ordinal schedule is a property of this finite fixture
only; it is explicitly **not** a general natural-language intent-routing
mechanism, and no text classifier is added anywhere. An ordinary owner message
never implicitly steers a run, enters A's mailbox, or grants any cross-task
mutation. Explicit owner `run.steer` / `run.cancel` commands target only their
admitted task.

Non-goals (explicitly out of scope for this slice):

- No upgrade, rewrite, or reinterpretation of Stage A (warm), legacy bootstrap,
  or historical grant rows. No relaxation of production execution/native
  verification flags. No text-only completion exception reuse for any admission
  of this generation.
- No widening of `AgentCommandBoundary`: owner-alpha mutations remain denied for
  agent commands.
- **Mutations and effects are default-denied for this generation.** Every
  runtime type not on a host/task allowlist in §6 is denied, including
  `effect-intent`/`effect-result`, `resource-acquire`/`resource-release`,
  `root-child-effect-*`, `agent-command`, `question-*`, `budget-report`,
  `flight-*`, `prepare-sleep`/`commit-sleep`, and `whatsapp-*`. No blanket
  alpha agent-command widening.
- No successor revision, rollover, or general recovery/sleep settlement claims.
- No automatic transition that contradicts the Stage A terminal one-revision
  contract (see §14).
- No paid/live/account/model/provider calls; no push/deploy/credentials/schedule
  activation/production gates.

## 1. Configuration

Secret environment variable `HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION`.
Strict JSON, fail closed on any unknown or missing shape:

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-background-generation-v1",
  "installation_id": "<must equal INSTALLATION_ID>",
  "owner_id": "<authenticated owner subject; must not match /^(runtime|trigger):/>",
  "owner_binding_sha256": "<hex64, installation owner binding>",
  "policy_revision": "<nonempty string, unique across all persisted generation revisions>",
  "persona_id": "<uuid>",
  "background": {
    "profile_version": "codex-background-v2-restricted-v1",
    "profile_sha256": "<hex64>",
    "max_resident_child_threads": 2,
    "wait_agent_enabled": false,
    "multi_agent_v1": false
  },
  "expires_at": "<absolute UTC ISO-8601, millisecond precision>",
  "max_task_seconds": 300,
  "max_admissions": 3,
  "prior_cost_micro_usd": 0,
  "prior_cost_source": "<nonempty string>",
  "total_cap_micro_usd": 1000000,
  "reservation_micro_usd": 10000,
  "seed_retirement": {}
}
```

Type:

```ts
type BackgroundProfile={
  profile_version:'codex-background-v2-restricted-v1';
  profile_sha256:string;              // hex64
  max_resident_child_threads:2;       // includes the root thread
  wait_agent_enabled:false;
  multi_agent_v1:false;
};
type BackgroundGenerationConfig={
  schema_version:1;kind:'owner-alpha-background-generation-v1';
  installation_id:string;owner_id:string;owner_binding_sha256:string;policy_revision:string;persona_id:string;
  background:BackgroundProfile;expires_at:string;max_task_seconds:number;max_admissions:3;
  prior_cost_micro_usd:number;prior_cost_source:string;total_cap_micro_usd:number;reservation_micro_usd:number;
  seed_retirement?:OwnerAlphaRetirement;
};
type BackgroundPersistedConfig=Omit<BackgroundGenerationConfig,'seed_retirement'>;
```

Canonical key list (exact-match, sorted): `background, expires_at,
installation_id, kind, max_admissions, max_task_seconds, owner_binding_sha256,
owner_id, persona_id, policy_revision, prior_cost_micro_usd, prior_cost_source,
reservation_micro_usd, schema_version, total_cap_micro_usd`, plus
`seed_retirement` only when present (mirroring Stage A's optional-seed rule).

Validation (all fail with `INVALID_CONFIGURATION`, HTTP 503):

- `schema_version === 1`, `kind === 'owner-alpha-background-generation-v1'`,
  `max_admissions === 3`;
- `installation_id`, `owner_id`, `policy_revision`, `prior_cost_source` are
  nonempty strings ≤ 256 bytes; `owner_id` must not match `/^(runtime|trigger):/`;
- `owner_binding_sha256`, `background.profile_sha256` are hex64;
- `persona_id` is a UUID; `background.profile_version ===
  'codex-background-v2-restricted-v1'`; `max_resident_child_threads === 2`;
  `wait_agent_enabled === false`; `multi_agent_v1 === false`;
- `expires_at` is absolute UTC ISO-8601 with milliseconds;
- `max_task_seconds` is a safe integer in `[1, 300]`;
  `prior_cost_micro_usd`, `total_cap_micro_usd`, `reservation_micro_usd` are
  safe nonnegative integers; `reservation_micro_usd > 0`;
- `seed_retirement`, when present, must satisfy the existing
  `retirementShape` predicate (Stage A shape, reused unchanged).

Mutual exclusion — configuring background requires all of:

1. A hosted owner-alpha installation with an already-supported retired predecessor:
   either (a) a fresh disposable fixture with expired epoch-1 hosted policy and
   exact seed retirement, or (b) an existing legacy predecessor whose generation is expired
   and retired with recorded `owner_alpha_retirement:{epoch}` evidence and the
   predecessor runtime fully drained — the exact Stage A pre-admission checks
   (`prior.expires_at <= now`, lifecycle phase `RECOVERY_REQUIRED`,
   `lease_until` expired, `provider_ref_json === '{}'`,
   `provider_operation_id === null`; src/core/owner-alpha-warm.ts
   `assertMessageAdmission`, no-generation branch). A truly empty epoch-0
   installation is not directly admitted: seed the disposable predecessor through
   existing fixture surfaces. Production Worker configuration requires
   `HEHEBOT_HOSTED_OWNER_ALPHA`; do not substitute the loopback legacy environment
   bypass for hosted authentication.
2. **No Stage A warm custody**: no `HEHEBOT_OWNER_ALPHA_WARM_GENERATION`
   configuration and no `owner_alpha_warm_generation:*` row in
   `runtime_metadata` (configured or retained). An installation with retained
   warm custody cannot configure background in this slice; there is no
   transition from Stage A custody.
3. No successor configuration.
4. `EXECUTION_ENABLED === false` (production execution and native verification
   flags stay false until their documented gates pass).
5. Four pairwise-distinct secrets (see §7): manager bearer token, background
   host signing key, background task signing key, and `RUNTIME_TOKEN`
   (the retained legacy runtime token must remain distinct and never be used by
   background routes).
6. A private wake destination for the once-only wake intent (§10).

## 2. Admission schedule and predicates

Roles are fixed by admission ordinal. Message text is never classified. The
same message bytes admitted at ordinal 1 and ordinal 2 produce role
`background` and role `status` respectively; no textual difference is inspected
or recorded.

### Admission 1 — A, role `background`

The first admission **creates** the generation; it does not require one to
exist. This mirrors `OwnerAlphaWarm.assertMessageAdmission` (validation only,
no generation row yet) followed by `assignNewMessage` (the write-once
admission transaction) in src/core/owner-alpha-warm.ts.

**Pre-admission custody checks** (validation only, no writes; none may assume a
BOOTING or live background generation — that state exists only after this
admission commits):

1. No `owner_alpha_background_generation:*` row exists; history is consistent
   (at most one row ever).
2. The predecessor is fully retired: a legacy `HEHEBOT_OWNER_ALPHA` generation
   with `prior.expires_at <= now`, lifecycle phase `RECOVERY_REQUIRED`,
   `lease_until !== null && lease_until <= now`, `provider_ref_json === '{}'`,
   `provider_operation_id === null` — or fresh epoch-1 custody, which requires
   a matching `seed_retirement` (exact Stage A predicate, including the
   recorded predecessor retirement evidence at epoch > 1).
3. No warm custody rows exist (this slice; see §1).
4. The candidate message is a direct owner message for the configured persona,
   owner-bound, ≤ 32768 bytes UTF-8, before the alpha cutoff, and the persona
   is not archived.
5. The cost baseline matches the lifetime ledger (`owner_alpha_cost_baseline`),
   budget headroom holds (§12), and at least 1000 ms remain for both the
   generation window `min(config.expires_at, now + 300_000 ms)` and the frozen
   task deadline (§5) — both computed inside the admission transaction.

**Admission transaction** (write-once, mirroring `assignNewMessage`): creates
`epoch = state.epoch + 1` with fresh `boot_id`, `transition_id`, `session_id`
UUIDs (no attempts may exist under the new `boot_id`), persists the config row
and cost baseline if absent, records the seed retirement at epoch 1, writes the
immutable generation descriptor, manifest `:1`, reservation
`owner_alpha_reservation:{epoch}:1`, and moves the lifecycle to `BOOTING` with
lease `min(generation expires_at, now + 90 s)`.

**Post-transaction launch envelope predicate** (the manager `generation` read
in §6 — not an admission predicate): requires the background generation to be
the active lifecycle generation with matching epoch/boot, `state.phase ===
'BOOTING'`, a live lease, and expiry in the future; it issues the host
credential with `issued_at` frozen at admission-1's manifest `issued_at` so
repeated reads produce identical bytes with zero writes (the exact Stage A
`warmManager('generation')` behavior).

### Admission 2 — S, role `status`

Admitted only when all hold:

1. The generation is live: READY, lease live, unexpired.
2. Manifest `:1` exists with role `background` and a valid digest chain (§4).
3. **Trusted A coordinator-release is durably observed**: the attempts row for
   A's run has `coordinator_release_json` whose `native_ref` equals that
   attempt's `native_run_ref` and whose `outcome` is one of
   `completed | failed | interrupted` — the exact observation recorded by the
   existing `coordinator-release` route. Absence denies admission with
   `RESOURCE_BUSY` (409): S is never admitted while A's root inference occupies
   the lane. A's descendants need **not** be settled; this predicate replaces
   Stage A's second-admission `assertWarmRunSettled(m1)` full-settlement
   requirement and adds no settlement claim for A or its descendants.
4. No pending controller activity anywhere: no `controller_operations` row
   with status `pending`, `submitted`, or `unknown` — the exact global Stage A
   predicate (src/core/owner-alpha-warm.ts, `assertMessageAdmission`,
   second-admission branch). This predicate does not consider A's registered
   descendants (they are runs, not controller operations), so it never blocks S
   admission while an A child remains active.
5. Budget headroom (§12) and at least 1000 ms remaining before S's frozen
   deadline (§5).

Writes: manifest `:2` (including the frozen `status_summary_sha256`, §9) and
reservation `:2`; the run. **No new generation row, no new wake intent** — the
executor must already be live.

**Claim-side verification (no broadening).** Once S is admitted and queued, the
existing `Lifecycle.claim` scheduling guards select S without any widening of unrelated
tasks:

- The coordinator-lane predicate ignores any coordinator run whose current
  attempt carries a committed `coordinator_release_json` with matching
  `native_ref` and terminal `outcome` (src/core/lifecycle.ts, `claim` SQL);
  a released A is not a lane blocker.
- The unresolved-family cap counts only coordinator-role runs; A's child has
  role `background` with a parent run, so it is never counted.
- The only predicate this contract changes is admission-side
  (coordinator-release observed for A instead of full settlement), scoped to
  A's admitted run. No guard for unrelated tasks or conversations changes.

The claim's context reconstruction does change for these admitted roots only:
`Lifecycle.claim` currently calls generic `ControlCore.context`, which includes
prior owner messages, provisional replies and child titles. It must select the
restricted background snapshot in §9 instead; keeping the scheduling SQL does
not imply keeping generic context composition.

### Admission 3 — B, role `independent`

Admitted only when all hold:

1. The generation is live (as above).
2. **S is settled**: S's attempt is completed with a valid background receipt
   (§13) and coordinator-release `completed`, with no unsettled operations,
   effects, locks, or questions for S. S has no descendants by construction
   (§8).
3. Manifests `:1` and `:2` exist with valid digest chains. A's descendants need
   not be settled.
4. No pending controller activity anywhere (the same global Stage A predicate
   as admission 2).
5. Budget headroom and at least 1000 ms remaining before B's frozen deadline.

Writes: manifest `:3` and reservation `:3`; the run. No new generation row, no
new wake intent.

After admission 3 the generation admits nothing further, ever. Exact replay of
any admitted activation event reconstructs the same run, manifest, reservation,
and wake intent — it never creates a new run, wake, or reservation.

## 3. Persisted records

All rows live in `runtime_metadata` (actual SQLite). Descriptor, manifest, summary,
receipt and reservation records are immutable. Wake outcome recording retains
the existing UNKNOWN-to-queued/diagnostic update semantics without redispatch:

| Key | Kind | Mutability |
| --- | --- | --- |
| `owner_alpha_background_config:{policy_revision}` | `BackgroundPersistedConfig` | write-once; at most one revision may ever exist |
| `owner_alpha_background_generation:{epoch}` | immutable descriptor (admissions excluded) | write-once, INSERT only; conflicting bytes are a validation error, identical bytes are idempotent |
| `owner_alpha_background_manifest:{epoch}:{1\|2\|3}` | `BackgroundManifest` | append-only, INSERT only |
| `owner_alpha_background_status:{epoch}:2` | canonical `BackgroundStatusSummary` bytes | write-once in admission-2 transaction; SHA-256 equals manifest's status summary digest |
| `owner_alpha_background_receipt:{run_id}:1` | root-only completion receipt | write-once in S/B completion transaction; exact replay only |
| `owner_alpha_reservation:{epoch}:{1\|2\|3}` | reservation row (Stage A shape) | append-only |
| `owner_alpha_wake:{epoch}` | wake intent | once-only, exact generation identity |
| `owner_alpha_retirement:{epoch}` | retirement evidence (Stage A shape) | after expiry, idempotent |

The generation descriptor mirrors the Stage A warm descriptor:

```ts
type BackgroundMessageBoundAuthority={
  kind:'owner-message-background-generation';
  config_sha256:string;generation_sha256:string;admissions:BackgroundManifest[];
};
type BackgroundGenerationView=OwnerAlphaGeneration&{authority:BackgroundMessageBoundAuthority};
```

`OwnerAlpha.generations()` (src/core/owner-alpha.ts) gains this third authority
kind alongside `owner-message-bootstrap-generation` and
`owner-message-warm-generation`; epochs stay contiguous with unique identities
across the merged chain.

```ts
type BackgroundRole='background'|'status'|'independent';
type BackgroundManifest={
  schema_version:1;kind:'owner-alpha-background-manifest-v1';admission:1|2|3;role:BackgroundRole;
  installation_id:string;owner_binding_sha256:string;run_id:string;persona_id:string;
  command_id:string;command_sha256:string;event_sequence:number;policy_revision:string;
  epoch:number;boot_id:string;transition_id:string;session_id:string;background:BackgroundProfile;
  issued_at:string;expires_at:string;reservation_micro_usd:number;generation_sha256:string;manifest_sha256:string;
  status_summary_sha256?:string;   // required iff role==='status'; forbidden otherwise
};
```

Canonical manifest key list (exact-match, sorted): `admission, background,
boot_id, command_id, command_sha256, epoch, event_sequence, expires_at,
generation_sha256, installation_id, issued_at, kind, manifest_sha256,
owner_binding_sha256, persona_id, policy_revision, reservation_micro_usd, role,
run_id, schema_version, session_id, transition_id`, plus
`status_summary_sha256` iff `role === 'status'`.

## 4. Digests

Three separate versioned digests (SHA-256 over `JSON.stringify` of the listed
arrays, Stage A `digest` helper). Never reuse `ownerAlphaManifestSha256`,
`warmConfigSha256`, or `warmManifestSha256`.

```ts
// Persisted policy record; excludes optional seed_retirement (Stage A rule).
backgroundConfigSha256(config:BackgroundPersistedConfig):string
// digest([schema_version,kind,installation_id,owner_id,owner_binding_sha256,policy_revision,persona_id,
//   background.profile_version,background.profile_sha256,background.max_resident_child_threads,
//   background.wait_agent_enabled,background.multi_agent_v1,expires_at,max_task_seconds,max_admissions,
//   prior_cost_micro_usd,prior_cost_source,total_cap_micro_usd,reservation_micro_usd])

// Per-admission manifest; admissions excluded from the generation digest.
backgroundManifestSha256(m:Omit<BackgroundManifest,'manifest_sha256'>):string
// digest([schema_version,kind,admission,role,installation_id,owner_binding_sha256,run_id,persona_id,
//   command_id,command_sha256,event_sequence,policy_revision,epoch,boot_id,transition_id,session_id,
//   background.profile_version,background.profile_sha256,background.max_resident_child_threads,
//   background.wait_agent_enabled,background.multi_agent_v1,issued_at,expires_at,reservation_micro_usd,
//   generation_sha256,m.status_summary_sha256??null])

// Immutable generation descriptor; admissions excluded so the digest survives
// later admissions without rewriting history.
backgroundGenerationSha256(g:Omit<BackgroundGenerationView,'authority'>&{authority:Pick<BackgroundMessageBoundAuthority,'kind'|'config_sha256'>}):string
// digest([epoch,boot_id,transition_id,policy.session_id,policy.persona_id,policy.expires_at,policy.max_runs,
//   policy.max_task_seconds,policy.background.profile_version,policy.background.profile_sha256,
//   predecessor.epoch,predecessor.boot_id,predecessor.session_id,activation_command_id,
//   activation_command_sha256,activation_event_sequence,authority.kind,authority.config_sha256])
```

`policy.max_runs === 3` for this generation. Validation
(`validateBackgroundGenerationView`) recomputes every digest from the durable
rows and fails closed on any mismatch, any rewritten row, or any missing
predecessor retirement evidence.

## 5. Deadlines, claim, and lease

- **Generation ceiling ≤ 300 s absolute.** The frozen generation expiry is
  `min(config.expires_at, admission-1 issued_at + 300_000 ms)`. The whole
  generation — A, S, B, all descendants, all leases — ends at this instant.
- **Per-root deadline frozen at admission**: each manifest's `expires_at` is
  `min(generation expiry, manifest issued_at + max_task_seconds * 1000)`.
  Frozen at admission, never extended, never renegotiated.
- **Claim check before mutation**: a claim is accepted only when at least
  1000 ms remain before the claiming root's frozen deadline, checked before
  any durable mutation (Stage A rule).
- **Lease cannot outlive the generation**: every heartbeat/lease renewal
  computes `lease_until = min(generation expiry, now + 90 s)`.
- **Descendants inherit A's frozen deadline**: a registered A child's attempt
  `deadline_at` equals A's attempt `deadline_at` (existing V2 behavior).
  Descendant leases use the same generation-expiry cap. No heartbeat or lease
  can outlive the frozen generation expiry.

## 6. Endpoints and route tables

Routes live under `/internal/background/`. While a background generation is
configured or retained, `/internal/*` (legacy alpha) and `/internal/warm/*`
return 404 and their summaries are unavailable; conversely
`/internal/background/*` returns 404 unless a background generation is
configured or retained (the manager retirement route stays available while
retained).

### Manager routes (bearer manager token)

| Route | Body | Result |
| --- | --- | --- |
| `POST /internal/background/manager/generation` | `{}` | launch envelope; only while BOOTING with a live lease; `null` otherwise |
| `POST /internal/background/manager/retirement` | `OwnerAlphaRetirement` | retirement evidence after generation expiry; idempotent; grants no successor permission of any kind |

### Host routes (Bearer background host JWT, §7)

Every payload below is the existing `SCHEMAS/runtime.json` shape validated by
`validateRuntime`; this contract adds exactly one new optional payload field
(`background_receipt` on `complete`, §13) and invents no other payload shapes.

| Type | Payload (actual schema) | Notes |
| --- | --- | --- |
| `boot` | `{boot_id}` | existing shape |
| `ready` | `{identity:{epoch,boot_id}}` | existing shape |
| `claim` | `{identity:{epoch,boot_id}}` | sub-second deadline check **before** mutation; returns the claim envelope of §7 |
| `heartbeat` | `{identity, operations:[{id, run_id, attempt, kind ∈ inference\|tool\|child\|transfer\|node\|flush\|delivery, status ∈ active\|cancelling\|settled\|unknown, started_at, deadline_at, last_progress_at}]}` | operation targets must be the three admitted roots **or** A's registered descendants, all at attempt 1; nested (child-of-child) or foreign targets denied |
| `submitted` | `{identity, run_id, attempt, native_ref}` | |
| `coordinator-release` | `{identity, run_id, attempt, native_ref, outcome ∈ completed\|failed\|interrupted}` | observation-only receipt (existing semantics); admits S once durably observed for A |
| `complete` | `{identity, run_id, attempt, result:{status,text,error_code?,checkpoint?}, background_receipt?}` | §13; `background_receipt` is the one new schema field; the existing `text_only_receipt` field is never used by this generation |
| `status` | `{}` | terminal status codes |
| `output-preview` | `{identity, run_id, attempt, native_ref, version, text ≤ 8192, truncated}` | targets: roots + A's descendants |
| `token-usage` | `{identity, run_id, attempt, native_ref, version, usage:{total, last, modelContextWindow}}` | targets: roots + A's descendants |
| `steer-pending` | `{identity, targets:[{run_id,attempt}]}` | bounded read; targets scoped to this generation |
| `steer-result` | `{identity, run_id, attempt, command_id, status ∈ accepted\|outcome_unknown\|not_delivered}` | records delivery outcome for this generation's targets using the existing schema unchanged (Q5 resolved) |
| `native-child` | `{identity, child:{parent_run_id, parent_attempt, persona_id, native_run_ref, native_session_key, title}, started?}` | registers an **observed** A child; `child.parent_run_id` must equal A's admitted `run_id` with `parent_attempt === 1`; parents S and B are denied; idempotent; observation only, never custody settlement |

Every run reference in a host payload — top-level `run_id`, heartbeat
`operations[]`, `steer-pending` `targets[]`, and `steer-result` `run_id` — must
be an admitted run of this generation at attempt 1 **or** an A-registered
descendant at attempt 1 (widening the exact Stage A admitted-set check in
src/worker/control-object.ts `warmRuntime`, `check()` helper); nested
child-of-child targets are denied.

Host routes are lifecycle/observation routes. They are separate from model task
reads (§7): the host credential never reaches the model, and model task
credentials never reach host routes. Host observations record which run they
target as asserted by the host; they do **not** claim per-child authenticated
provenance (stdio MCP and native-child observations are host-asserted only —
`docs/NATIVE_ORCHESTRATION.md`).

Denied for host (explicit): `question-*`, `effect-*`, `resource-*`,
`agent-command`, `budget-report`, `flight-*`, `root-child-effect-*`,
`whatsapp-*`, `agent-skill-search`, `prepare-sleep`, `commit-sleep`, and every
legacy/warm-only type. Mutations and effects are default-denied: any type not
on the table above is denied.

### Task routes (Bearer background task JWT, §7)

Allowed types and payloads (existing `SCHEMAS/runtime.json` shapes):

- `agent-routines`: `{identity:{epoch,boot_id}, run_id, attempt, id?, after?}`;
- `agent-skill`: `{identity:{epoch,boot_id}, run_id, attempt, skill_id}`.

Cross-checks on every task call:

- payload `run_id === grant.run_id` and `attempt === 1`;
- the grant's `manifest_sha256` must be an admitted manifest of the live
  background generation;
- any other type, any other run, any nested/foreign target, any host or
  manager route: denied.

A's descendants call task routes with A's task grant (A's `run_id`, A's
manifest) — task-level provenance, not per-child authenticated provenance. S's
task grant exists (uniform machinery) but S is composed with no MCP server, so
no task route is reachable from S. B's task grant backs B's read-only MCP
(`agent-routines`/`agent-skill` only) via its own per-task credential file.

## 7. Host credential: audiences, JWT shapes, per-task credential files

Four deployment secrets, pairwise distinct (Stage A rule, following the actual
naming pattern in src/worker/secrets.d.ts and src/worker/control-object.ts):
the existing manager token `HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN`, new
`HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY`, new
`HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY`, and the retained
`RUNTIME_TOKEN` (legacy; never used by background routes).

```ts
export interface BackgroundHostGrant {
  installation_id:string;epoch:number;boot_id:string;transition_id:string;generation_sha256:string;
  issued_at:string;expires_at:string;                    // field list identical to WarmHostGrant
}
// audience 'hehebot-background-generation'; typ 'hehebot-background-generation+jwt';
// subject boot_id; HS256; issuer `hehebot:{installation_id}`; iat=nbf=issued; exp=expires;
// duration within [1 s, 300 s]; issued only while BOOTING and live.

export interface BackgroundTaskGrant extends BackgroundHostGrant {
  owner_binding_sha256:string;run_id:string;attempt:1;manifest_sha256:string;   // + role via manifest
}
// audience 'hehebot-background-task'; typ 'hehebot-background-task+jwt';
// subject run_id; same claim shape and verification rules as WarmTaskToken.
```

`issueBackgroundHostToken` / `verifyBackgroundHostToken` /
`issueBackgroundTaskToken` / `verifyBackgroundTaskToken` mirror the Stage A
functions in src/worker/auth.ts exactly (same key lists, same timestamp rules,
same clock-tolerance-0 verification), with the new audience strings.

### Per-task credential files (replacing shared host authority)

Stage B does **not** point MCP grants at the shared `config.runtimeTokenFile`.
At claim, the Durable Object returns:

```ts
type BackgroundClaimEnvelope={
  schema_version:1;kind:'owner-alpha-background-claim-v1';
  run:Run;                                     // the FULL durable run row (src/core/types.ts Run: role, parent_run_id,
                                               // title, id, command_id, occurrence_id, persona_id, routine_id,
                                               // context_json, status, current_attempt, error_code,
                                               // checkpoint_json, created_at, updated_at) as returned by
                                               // store.run() — including the freshly computed context_json
  submission_key:string;                       // `${run.id}:1`
  deadline_at:string;                          // frozen manifest expires_at
  role:BackgroundRole;
  background:BackgroundProfile;                // full restricted V2 profile descriptor
  manifest:{admission:1|2|3;role:BackgroundRole;manifest_sha256:string;expires_at:string};
  task_credential:{grant:BackgroundTaskGrant;token:string};
  status_summary?:BackgroundStatusSummary;     // iff role==='status'
  owner_alpha_background?:true;                 // set only for role 'background' (A): reuses the existing claim
                                               // flag consumed by runtime/execution-bridge.mjs to enable the V2
                                               // thread feature set. S and B omit it, exactly like non-background
                                               // claims; neither owner_alpha_background nor text_only appears.
};
```

This mirrors the actual Stage A claim response (src/worker/control-object.ts
`warmRuntime` `claim` case: `{schema_version, kind, run: <full row from
lifecycle.claim>, submission_key, deadline_at, manifest, task_credential}`) —
`run` is never reduced to `id`/`current_attempt`; the execution bridge requires
the durable row and its `context_json` to compose the native thread.

The executor claim stage (analog of `stageWarmClaim` in
runtime/owner-alpha-warm-binding.mjs, proposed as
`stageBackgroundClaim` in runtime/owner-alpha-background-binding.mjs) writes
the task token **write-once** to `task-tokens/{run_id}` (mode 0o600), then
composes the task-scoped MCP grant for that root with
`tokenFile: task-tokens/{run_id}` — never `config.runtimeTokenFile`. The file
holds only the task JWT. Manager tokens, host signing keys, host JWTs, and
`RUNTIME_TOKEN` never appear in any file under `task-tokens/` or in any MCP
server configuration. The native sandbox deny rules keep `task-tokens/`
unreadable to the model (existing rules). A's descendants inherit A's
task-scoped MCP configuration natively (verified V2 behavior); S and B have
their own per-task files. Re-claiming reconstructs identical bytes; no file is
ever rewritten with different content.

## 8. Descendant custody (A's children)

- Only A (role `background`, admitted manifest `:1`) may be the parent of a
  registered native child. `NativeTaskLedger.register`
  (src/core/native-tasks.ts) is gated to A's admitted run for this generation;
  a parent run of S or B is denied.
- Child registration is host-asserted observation via the `native-child` host
  route. Native completion/eviction is deliberately **not** represented as
  Worker settlement (V2 rule). This slice adds **no settlement proof for
  descendants**: they are observed, never settled. This wording does not forbid
  a future supported reconciliation path; none is defined or implied here.
- Children inherit A's frozen attempt deadline (§5) and never their own
  reservation, wake intent, or manifest. A descendants may share A's logical
  task grant; S and B never do — there is no per-child credential.
- Native child registration preserves the V2 native evidence: fresh independent
  roots are supported while an A child is active, and foreign-root UUID V2
  controls are rejected before and after eviction.

## 9. Status answer (S) — bounded durable summary

S returns a status answer whose context contains **no A private transcript**.
At S admission the control plane computes and freezes:

```ts
type BackgroundStatusSummary={
  schema_version:1;kind:'owner-alpha-background-status-summary-v1';
  generation:{epoch:number;generation_sha256:string};
  admissions:Array<{                       // ordinal order; only admissions already issued
    admission:1|2|3;role:BackgroundRole;run_id:string;
    run_status:string;attempt_status:string|null;coordinator_released:boolean;
    deadline_at:string;child_count:number;manifest_sha256:string;
  }>;
  computed_at:string;                       // equals admission-2 manifest issued_at
};
```

Bounds: fixed field set, statuses and counts only. No transcripts, no message
text, no context bytes, no output previews, no native session keys, no JWT
material, no `task-tokens/` contents. Canonical serialization is
`JSON.stringify` of the plain object with the key order above and admissions in
ordinal order; it is deterministic given the durable rows. The summary is
computed by the control plane from durable state (authorized), frozen into
manifest `:2` as `status_summary_sha256`, embedded in S's claim envelope, and
composed into S's prompt context by the runtime together with the owner
message. Building it grants no cross-task mutation: it is a read-only
derivation; no effect, lock, mailbox, or steering capability is extended to S.
The frozen bytes are immutable; later state changes never rewrite manifest `:2`.

Persist the canonical summary bytes in `owner_alpha_background_status:{epoch}:2`
in the same transaction as manifest 2. It summarizes admission 1 only (the
already-issued admissions before S); it cannot include its own manifest hash.
Claim and reconstruction read those bytes and verify the digest and exact schema;
they never recompute a summary from newer state. Missing or changed bytes fail closed.

For this finite slice all three roots use a restricted `ContextSnapshot` at
enqueue and claim: the selected persona, that root's own instruction, its own
scope key, `routine:null`, `room_id:null`, and empty memories, skills,
context_events and authorization_policy_ids. Omit conversation_history,
task_summaries, context_history_gap and WhatsApp grants. Use a task-specific
scope key once the run ID exists. S additionally receives only the frozen summary
through its claim envelope. A and B receive no other root's summary or transcript.
The read-only MCP reads allowed for A/B remain separately scoped/authenticated;
empty prompt skills do not widen that authority. Do not rely on runtime prompt
instructions to suppress private fields already sent in `context_json`.
Tests must place distinct canaries in A's instruction, preview, child title and
shared memories/history and prove they are absent from S/B claims, including
after DO reconstruction and later state changes.

## 10. Wake

Only admission 1 leads to the once-only wake intent `owner_alpha_wake:{epoch}`,
created by the existing hosted wake path (`Lifecycle.deliverOwnerAlphaWake`,
src/core/lifecycle.ts) while the generation is BOOTING with a next-claimable
run; the intent is written once, never replayed, and a failed delivery
preserves `status:'unknown'` with `HOSTED_WAKE_OUTCOME_UNKNOWN` — uncertainty is
preserved, never blindly replayed. Admissions 2 and 3 require a live executor
lease and create no new wake intent. Exact replay of the wake event
reconstructs the same intent; it never issues a new run or reservation. Stage A
wake rules (sender, no-replay, private destination) apply unchanged.

## 11. Owner summary and `/v1/state`

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-background-summary-v1",
  "policy_revision": "...",
  "persona_id": "<uuid>",
  "policy_expires_at": "<config absolute>",
  "max_admissions": 3,
  "admissions_used": 1,
  "message_admission_available": true,
  "next_role": "background | status | independent | null",
  "generation": {"session_id": "<uuid>", "expires_at": "<frozen>", "epoch": 2}
}
```

`next_role` is `background` before admission 1, `status` once A's
coordinator-release is durably observed and admission 2 is admissible,
`independent` once S is settled and admission 3 is admissible, and `null`
after admission 3 or when the generation is expired/retained.
`message_admission_available` is the authoritative admission gate. While
background is configured or retained, `summary.owner_alpha_session`,
`summary.owner_alpha_bootstrap`, and `summary.owner_alpha_warm` are unavailable.

## 12. Budget ledger

The cumulative lifetime ledger is preserved with **no reset and no refund**:

```ts
backgroundLedgerUsed(db, priorCostMicroUsd) =
  priorCostMicroUsd
  + sum of reservation_micro_usd of every row under GLOB 'owner_alpha_reservation:*'
    whose key matches /^owner_alpha_reservation:\d+(:[123])?$/
```

This includes every legacy row (`:{epoch}`), every Stage A warm row
(`:{epoch}:{1|2}`), and every background row (`:{epoch}:{1|2|3}`), whatever
their recorded outcome — `UNKNOWN` outcomes never release their reservation. The
Stage A `warmLedgerUsed` key regex `^owner_alpha_reservation:\d+(:[12])?$` must
be widened to accept `:3` (or subsumed by one shared cumulative predicate); the
fail-closed rule stays: any row under the prefix that does not match the widened
regex is a configuration error. An admission is denied with `BUDGET_EXCEEDED`
(402) when `used + reservation_micro_usd > total_cap_micro_usd`.

## 13. Completion — A never completes; S/B use a root-only receipt

**A (role `background`) never completes in this slice.** `complete` targeting A
is rejected — with or without any receipt. The existing `Lifecycle.complete`
already rejects owner-alpha family settlement (src/core/lifecycle.ts:
`requireThat(!this.core.ownerAlpha.policy||!!textOnly,'CAPABILITY_UNAVAILABLE',
'Owner alpha cannot assert family settlement.')`), and inventing a differently
named receipt must not bypass it. A's lifecycle in this slice is exactly:

1. `coordinator-release` — trusted observation only: it settles nothing,
   publishes no result, touches no deadline/lease/cancellation, and revives no
   old epoch (existing `coordinatorRelease` semantics);
2. A remains unsettled (`status:'running'` with committed
   `coordinator_release_json`) — uncertainty about its descendants is
   preserved and never inferred away;
3. A can be explicitly cancelled by the owner (`run.cancel`).

No sleep permission is granted at any point: `prepare-sleep`/`commit-sleep`
are denied on background routes, and no recovery or sleep settlement is
claimed for A or its descendants.

**S and B (roles `status`/`independent`) complete with a separately
constrained root-only proof**: the new optional `background_receipt` field on
the `complete` payload (§6) — the only new schema field in
`SCHEMAS/runtime.json`:

```ts
// complete payload addition (mirrors text_only_receipt's placement, not its meaning)
type BackgroundReceipt={
  thread_id:string;    // 1..256 chars; host-asserted native thread identity
  turn_id:string;      // 1..256 chars; must equal the attempt's native run ref
  output_sha256:string;// hex64; must equal sha256(result.text)
};
```

Validation on `complete` for roles `status`/`independent`:

- the attempt is the root's current attempt and the run is an admitted
  manifest root of this generation whose role is `status` or `independent`
  (a role-`background` target is rejected above, before any receipt is read);
- `result.status === 'completed'` with no error code or checkpoint payload;
- `receipt.turn_id` equals the attempt's durable `native_run_ref`;
  `thread_id` is a host assertion: the attempts table has no independent root
  thread-ID column. The runtime checks it against its journaled thread binding;
  the Worker validates shape and persists it with the exact receipt, not a
  nonexistent independently authenticated thread observation;
- `receipt.output_sha256 === sha256(result.text)`;
- the attempt has `coordinator_release_json` with `native_ref ===
  receipt.turn_id` and `outcome === 'completed'`;
- no children (child registration for parents S/B was denied at §8), no
  unresolved operations, effects, locks, or questions for the root.

Persist `owner_alpha_background_receipt:{run_id}:1` atomically with the result
and canonical publication. Identical replay is idempotent; altered receipt or
result is rejected. S-settlement admission checks require this durable proof.
Reject mixed text-only/background receipts and reject background receipts for
legacy/warm/non-background tasks before any mutation.

The existing text-only receipt path is never used for this generation: the
root-only background branch is new code, never a relaxation of `textOnly`
validation.

Cancellation:

- explicit owner `run.cancel` of A cascades only to A's descendants via
  `native_task_links` (existing `propagateCancellation` semantics for background
  roots); S and B are unaffected — they are not descendants;
- `run.cancel` of S or B affects only that run;
- generation expiry fences the watchdog to the generation epoch/boot and
  requests cancellation/recovery under existing rules. Expiry does not prove
  native termination, descendant settlement or successful sleep.

Steering:

- only the exact owner `run.steer` command (accepted/applied status, exact
  `run_id` and `expected_attempt`, validated by `TaskSteering`) steers a run;
  ordinary messages never implicitly steer;
- steering targets are the admitted roots and A's registered descendants of
  this generation; nested children (child-of-child) remain rejected as nested
  targets, and foreign runs are denied;
- `steer-pending` / `steer-result` host routes are scoped to the same target
  set using the existing payload schemas unchanged.

## 14. Removal, retirement, and relationship to Stage A custody

- Removing `HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION` while a background
  generation is configured and live fails closed: `/internal/background/*`
  denies, custody rows stay immutable, and the generation reconstructs only
  when the exact configuration returns; a changed configuration is denied.
- After expiry, the manager retirement route records `owner_alpha_retirement`
  evidence (Stage A shape) once; replay is idempotent.
- Retirement is terminal for the background generation: there is **no successor
  background revision, no rollover, and no permission granted by retirement**
  to any later generation. **Nothing may follow a background generation in this
  slice** (Q2 resolved conservatively); a later epoch is out of scope and would
  require a new parent decision.
- Stage A custody is preserved exactly: warm rows keep their meaning, warm
  routes keep their mutual exclusion, and the Stage A terminal one-revision
  contract is untouched and not expanded. **There is no transition from
  retained Stage A warm custody** (Q1 resolved conservatively): an installation
  with any `owner_alpha_warm_generation:*` row — configured or retained —
  cannot configure background in this slice. Background is configurable only on
  a fresh disposable installation or after an already-supported legacy
  predecessor (`HEHEBOT_OWNER_ALPHA`) that is expired and retired with exact
  recorded retirement evidence (§1).
- No general recovery or sleep settlement is claimed: passive context updates
  still enqueue no inference and request no wake; unknown external outcomes are
  never blindly replayed.

## 15. Recorded native-evidence limits

The existing V2 native evidence supports: a fresh independent root while an A
child's inference is active, and rejection of foreign-root UUID V2 controls
before and after eviction. It does **not** prove, and this contract does not
claim:

1. broad filesystem or network containment of native descendants;
2. live model or catalog eligibility (managed-auth subscription terms, quotas,
   hosted-use eligibility must be verified, not assumed);
3. managed-refresh race behavior;
4. recursive effects settlement;
5. canonical publication of child results;
6. ongoing responsiveness while A's coordinator still occupies the lane — this
   contract therefore admits S only after a trusted A coordinator-release is
   durably observed, never during A's root inference.

## 16. Parent decisions (resolved in revision 2) and change log

Resolved by the parent review; this revision records the decisions:

1. **Q1 — no transition after retained Stage A warm custody.** Background is
   configurable only on a fresh disposable installation or after an
   already-supported legacy predecessor with exact retirement evidence (§1,
   §14). Stage A's terminal one-revision contract is not silently expanded.
2. **Q2 — no successor after background in this slice.** Nothing may follow a
   background generation; retirement grants no permission to any later epoch
   (§14).
3. **Q3 — fixed ordinal roles accepted for this finite fixture** (A=1, S=2,
   B=3). Explicitly not a general natural-language intent-routing mechanism;
   no text classifier exists (§0, §2).
4. **Q4 — S has no MCP; B has scoped read-only MCP**
   (`agent-routines`/`agent-skill` only) via its own per-task credential file
   (§6, §7).
5. **Q5 — scoped `steer-result` accepted** on the host allowlist using the
   actual existing payload schema, unchanged (§6).
6. **Q6 — A logical completion is rejected while descendants remain active.**
   The existing `Lifecycle.complete` owner-alpha family-settlement rejection
   is preserved; a differently named receipt must not bypass it. A releases its
   coordinator lane, remains unsettled, and can be explicitly cancelled. S/B
   use a separately constrained root-only completion proof with no
   children/operations/effects/questions/locks (§13). Uncertainty is preserved
   and no sleep permission is granted.

Revision-2 change log (defects corrected in this pass):

- §0 now **requires** default-denied mutations/effects (previously stated no
  default-deny contract).
- §2 first admission no longer circularly requires a BOOTING/live generation
  before creating it: pre-admission custody checks, the write-once admission
  transaction, and the post-transaction launch envelope predicate are separated,
  referencing `assertMessageAdmission`/`assignNewMessage` in
  src/core/owner-alpha-warm.ts.
- §6 payload tables now enumerate the actual `SCHEMAS/runtime.json` payload
  shapes (snake_case); the only new schema field is the optional
  `background_receipt` on `complete`.
- §7 claim envelope now returns the full durable run row (including
  `context_json`) as `store.run()`/`Lifecycle.claim` produce, not a reduced
  `{id,current_attempt}`.
- §8 no longer says descendants "never settle"; it states this slice adds no
  settlement proof without forbidding a future supported reconciliation.
- §1 corrected the Stage A configuration environment name to
  `HEHEBOT_OWNER_ALPHA_WARM_GENERATION` (src/worker/secrets.d.ts,
  src/worker/control-object.ts, src/worker/index.ts).
- Claim/coordinator-release guards verified: S is claimable after A's release
  while A's child remains active with no broadening of unrelated tasks (§2).

Remaining notes (no known contradictions):

- The `owner_alpha_background` claim flag is reused with its existing meaning
  (V2 thread feature enablement, src/core/lifecycle.ts `claim`) and set only
  for A; Stage B adds the envelope kind and `role` for binding-layer
  discrimination. This is additive, not a reinterpretation.
- The per-root claim deadline is the frozen manifest `expires_at` returned
  through the `OwnerAlpha.admit(run)` extension point, mirroring Stage A; it
  must not be recomputed fresh at claim time.
- `native-child` payloads carry `persona_id` and `title` per the existing
  schema; the parent gating uses `child.parent_run_id` only, and S/B parents
  are denied regardless of persona/title contents.

## 17. Minimum acceptance matrix

### Contract tests (deterministic; actual SQLite + signed HTTP; no model calls)

| # | Test | Verifies |
| --- | --- | --- |
| C1 | boot/ready/claim/envelope; executor restart; reconstruction | signed HTTP callback/claim/reconstruction from durable rows; generation and manifest digests revalidate; rewriting a generation/manifest row with different bytes fails validation (immutable predecessor bytes) |
| C2 | admission schedule | A admitted; S denied before A coordinator-release; S admitted after release while a registered A child is active; B denied before S settles; B admitted after S settles; identical message text at different ordinals yields the recorded roles (no text inference) |
| C3 | cross denials | task JWT on host routes denied; host JWT on task routes denied; nested targets (steering/heartbeat into a child-of-child) denied; foreign run/attempt/manifest denied; manager token on host/task routes denied; legacy and warm routes 404 while background is live |
| C4 | boundaries | generation expiry frozen at first admission + 300 s; per-root frozen deadline; claim with < 1000 ms remaining denied before any mutation; lease capped at generation expiry; budget denial when used + reservation > cap; UNKNOWN outcome keeps its reservation; cumulative ledger includes legacy and warm rows |
| C5 | fail-closed removal | env removed mid-generation → routes deny; exact config returns → custody reconstructs; changed config denied; retirement idempotent and grants no successor |
| C6 | cancellation and completion isolation | explicit `run.cancel` of A cascades only to A's descendants; S and B unaffected; cancel of S leaves A/B unaffected; `complete` targeting A (with any receipt, including `background_receipt`) is rejected by the existing family-settlement path; `complete` for S/B without a valid `background_receipt` rejected |
| C7 | native-child route | registers an observed A child; parent S or B denied; idempotent replay; registration is never represented as settlement |

### Future native/live gates (not claimed by this contract)

| # | Gate |
| --- | --- |
| N1 | Native fixture (pinned 0.154.0 app-server; analog of `scripts/test-codex-owner-background-v2.mjs`): A child held active until S replies with A's identity, context, and grant unchanged; independent B admitted and completed; exact explicit A cancel leaves S and B unaffected |
| N2 | Live managed-auth eligibility (model catalog, subscription and hosted-use terms) |
| N3 | Managed-refresh race behavior under background residency |
| N4 | Broad filesystem/network containment of native descendants |
| N5 | Recursive effects settlement |

## 18. Affected source symbols (implementation map)

New files (subsequent assignment; not started until corrected review passes):

- `src/core/owner-alpha-background.ts` — `parseOwnerAlphaBackground`,
  `persistedBackgroundConfigRow`, `backgroundConfigSha256`,
  `backgroundGenerationSha256`, `backgroundManifestSha256`,
  `backgroundLedgerUsed`, `backgroundStatusSummary`, `backgroundRunSettled`,
  `backgroundAdmissionsView`, `validateBackgroundGenerationView`,
  `OwnerAlphaBackground` (pre-admission checks, admission transaction, and
  completion validation mirroring
  `OwnerAlphaWarm.assertMessageAdmission`/`assignNewMessage`),
  `BACKGROUND_CONFIG_KEYS`, `BACKGROUND_MANIFEST_KEYS`.
- `runtime/owner-alpha-background-binding.mjs` — `validateBackgroundLaunch`,
  `validateBackgroundClaim`, `stageBackgroundClaim` (write-once per-task token
  files under `task-tokens/{run_id}`), `backgroundGenerationBinding`.

Modified (additive; no Stage A, warm, or legacy row rewrites):

- `SCHEMAS/runtime.json` — exactly one new optional payload field:
  `background_receipt` on `complete` (§13); regenerate `src/generated/`
  with `npm run generate:contracts`; no hand-edited validators.
- `src/worker/secrets.d.ts` — new environment names
  (`HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION`,
  `HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY`,
  `HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY`), mirroring the existing
  Stage A declarations; the manager token reuses
  `HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN`.
- `src/worker/auth.ts` — `BackgroundHostGrant`, `BackgroundTaskGrant`,
  `issueBackgroundHostToken`, `verifyBackgroundHostToken`,
  `issueBackgroundTaskToken`, `verifyBackgroundTaskToken`,
  `assertBackgroundSecrets` (four pairwise-distinct secrets).
- `src/worker/control-object.ts` — `backgroundManager` / `backgroundRuntime`
  RPC methods beside `warmManager` / `warmRuntime`; the admitted-target check
  widened to include A's registered descendants at attempt 1 (the `check()`
  helper pattern in `warmRuntime`).
- `src/worker/index.ts` — `/internal/background/{manager,host,task}/*`
  dispatch; mutual exclusion with `/internal/*` and `/internal/warm/*`.
- `src/core/owner-alpha.ts` — `generations()` accepts
  `owner-message-background-generation`; `generationCustody`; `cutoff`;
  `eligible`/`admit` (returns the frozen manifest deadline); background-root
  accessor (role `background` root analog of `backgroundRoot`);
  `propagateCancellation` for background roots; `textOnly` untouched.
- `src/core/lifecycle.ts` — claim deadline gating from the frozen manifest
  deadline; `complete` root-only `background_receipt` branch for roles
  `status`/`independent` only — the existing family-settlement rejection
  (`requireThat(!this.core.ownerAlpha.policy||!!textOnly,...)`) is preserved,
  never bypassed for role `background`; `authorizeAttempt` for background
  descendants; `watchdog` fenced to the generation epoch/boot;
  `coordinatorRelease` unchanged; claim scheduling guards retained, with
  background-specific context composition and frozen deadline validation (§2/§9).
- `src/core/native-tasks.ts` — `NativeTaskLedger.register` gated to the
  generation's role-`background` root only.
- `src/core/owner-alpha-warm.ts` — `warmLedgerUsed` key regex widened to
  accept `:3` (or subsumed by a shared cumulative predicate); no other warm
  behavior change.
- `src/core/control.ts` — `/v1/state` `summary.owner_alpha_background`
  availability and mutual exclusion; background-specific enqueue/claim context
  with no cross-task transcript, leaving non-background message context unchanged.
- `src/core/agent-commands.ts` — **no change**; `AgentCommandBoundary` keeps
  rejecting owner-alpha mutations.
- `runtime/codex-service.mjs` — background composition; MCP grant `tokenFile`
  → staged per-task credential file (replaces shared `config.runtimeTokenFile`
  for this generation); V2 feature override applied only to role `background`
  thread starts.
- `runtime/execution-bridge.mjs` / `runtime/execution-supervisor.mjs` —
  `claimStage` wiring for the background generation.
- `runtime/codex-tasks.mjs` — descendant observation scope; steering target
  checks against this generation's admitted set.
