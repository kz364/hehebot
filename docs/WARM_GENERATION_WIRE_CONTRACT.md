# Warm owner-chat generation — Stage A wire contract

Version 1, default-off. This document is the exact wire contract for the runtime
implementor. It describes what the control plane implements today; nothing here
is a claim about native runtime or live acceptance.

## 1. Opt-in configuration

Environment variable `HEHEBOT_OWNER_ALPHA_WARM_GENERATION` (secret; never logged).
Strict JSON, fail-closed on unknown/missing fields:

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-warm-generation-v1",
  "installation_id": "<string, must equal INSTALLATION_ID>",
  "owner_id": "<authenticated owner subject>",
  "owner_binding_sha256": "<sha256 hex of the installation owner binding>",
  "policy_revision": "<nonempty string, differs from any predecessor manifest revision>",
  "persona_id": "<uuid>",
  "text_only": { "profile_version": "codex-text-only-v1", "profile_sha256": "<hex64>" },
  "expires_at": "<absolute UTC timestamp, whole-generation ceiling>",
  "max_task_seconds": 30,
  "max_admissions": 2,
  "prior_cost_micro_usd": 1000,
  "prior_cost_source": "<string>",
  "total_cap_micro_usd": 10000000,
  "reservation_micro_usd": 2000,
  "seed_retirement": { "...": "only for an initial hosted (epoch 1) predecessor" }
}
```

Mutually exclusive with bootstrap/successor/legacy owner-alpha configuration;
requires the hosted owner-alpha policy and `EXECUTION_ENABLED` false. Requires
four pairwise-distinct secrets: `HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN`,
`HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY`, `HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY`,
and `RUNTIME_TOKEN`. Also requires the private wake destination
(`HEHEBOT_OWNER_ALPHA_WAKE` + `HEHEBOT_OWNER_ALPHA_WAKE_TOKEN`).

## 2. Persisted records (SQLite, `runtime_metadata`)

| Key | Kind | Immutable |
| --- | --- | --- |
| `owner_alpha_warm_config:{policy_revision}` | `WarmPersistedConfig` (config minus `seed_retirement`) | yes, exactly one revision ever |
| `owner_alpha_warm_generation:{epoch}` | generation descriptor (admissions omitted) | yes, written once at creation, never rewritten |
| `owner_alpha_warm_manifest:{epoch}:1` / `:{epoch}:2` | `WarmManifest`, appended per admission | yes, appended only |
| `owner_alpha_reservation:{epoch}:1` / `:{epoch}:2` | `{manifest_sha256, micro_usd}` | yes |
| `owner_alpha_cost_baseline` | trusted prior cost/cap snapshot | first write only |
| `owner_alpha_retirement:{epoch}` | `OwnerAlphaRetirement` | yes, idempotent |
| `owner_alpha_wake:{epoch}` | once-only wake intent `{epoch, boot_id, transition_id, status:'unknown'}` | yes |

Digests are separate from legacy `ownerAlphaManifestSha256` and byte-identical
across reconstruction:

- `warmConfigSha256` — canonical digest of the persisted config record.
- `warmGenerationSha256` — digest of the immutable generation descriptor (epoch,
  boot/transition ids, session/persona/expiry/max_runs/max_task_seconds,
  text-only profile, predecessor identity, activation command/event, authority
  kind + config digest). Admissions are excluded so the digest survives the
  second admission without rewriting history.
- `warmManifestSha256` — per-admission digest over schema_version, kind,
  admission (1|2), installation, owner binding, run/persona/command ids, command
  hash, event sequence, policy revision, epoch/boot/transition/session ids,
  text-only profile, issued_at, **frozen expires_at**, reservation, and the
  generation digest.

The generation descriptor row is write-once: the second admission appends a
separate manifest row and reservation row, then reconstructs the admissions view
(strict contiguous 1..2 validation, fail-closed on orphan or mismatched rows).
The descriptor bytes, the first manifest bytes, and the generation digest are
byte-identical across the second admission, reopens, and retirement. Distinct
admissions are proven by distinct command id, run id, and event sequence —
command text and wall-clock millisecond may legitimately repeat (identical message
bodies retain the same command digest even with a fresh idempotency key, and
sequential commands may share a clock tick).

Legacy rows keep their exact meaning and are never rewritten.

## 3. Deadlines (frozen at admission)

- Generation expiry = `min(config expires_at, first admission time + 300 s)`,
  immutable after the first admission.
- Per-task deadline frozen in the manifest at admission:
  `min(generation expiry, admission time + max_task_seconds)`.
- A claim returns that persisted cap — a delayed claim never opens a new window.
  Task JWT `iat` = `attempt.started_at` (deterministic), `exp` = the frozen
  deadline.
- A claim with less than one full second of remaining lifetime (deadline minus
  now < 1000 ms, including the exact-deadline and final-partial-second cases) is
  rejected **before** any claim or attempt mutation: no orphan attempt is ever
  created and no signing can fail after an execute commit. Exactly one second
  remaining is the accepted boundary.

## 4. Endpoints

All under `/internal/warm/`, distinct versioned routes — legacy
`/internal/*` routes are **not** a bypass and fail closed while a warm
generation is configured or retained (404/401).

### Manager — `Authorization: Bearer <manager token>`

- `POST /internal/warm/manager/generation` — returns the launch envelope only
  while the generation is BOOTING and live; `null` once READY or retired.
  Reads assign nothing.
- `POST /internal/warm/manager/retirement` — accepted after generation expiry
  (`observed_at >= generation expires_at`), idempotent, settles no tasks and
  admits no successor by itself. Remains available after the configuration is
  removed while custody is retained.

Launch envelope (`owner-alpha-warm-launch-v1`):

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-warm-launch-v1",
  "generation": {
    "epoch": 2, "boot_id": "<uuid>", "transition_id": "<uuid>",
    "session_id": "<uuid>", "generation_sha256": "<hex64>",
    "policy": { "persona_id": "<uuid>", "expires_at": "<ts>", "max_runs": 2,
                "max_task_seconds": 30,
                "text_only": { "profile_version": "codex-text-only-v1", "profile_sha256": "<hex64>" } },
    "predecessor": { "epoch": 1, "boot_id": "<uuid>", "session_id": "<uuid>" }
  },
  "host_credential": { "grant": { "installation_id": "...", "epoch": 2, "boot_id": "...",
    "transition_id": "...", "generation_sha256": "...", "issued_at": "...", "expires_at": "..." },
    "token": "<host JWT>" }
}
```

### Host — `Authorization: Bearer <host JWT>`

JWT: HS256, `typ: "hehebot-runtime-generation+jwt"`, `iss: "hehebot:<installation>"`,
`aud: "hehebot-runtime-generation"`, `sub: <boot_id>`, `iat/nbf/exp`, `grant`
claim = `WarmHostGrant` (installation, epoch, boot/transition ids,
**generation_sha256**, issued/expires). Binds the immutable generation digest,
strict installation/owner/iat/exp validation; no downgrade when config is removed;
never valid for model/task routes.

Allowlist: `boot`, `ready`, `claim`, `heartbeat`, `submitted`,
`coordinator-release`, `complete`, `status`, `output-preview`, `token-usage`,
`steer-pending`.

- `output-preview` / `token-usage`: host-only observations with exact admitted
  run/attempt and native version checks. Task/model credentials never reach them.
- `steer-pending`: bounded read for service maintenance, targets scoped to
  admitted runs of this generation only.
- Denied in Stage A: `question-*`, `steer-result` (and everything else); text-only
  admits no questions or steering.
- Claim is additionally gated by the sub-second boundary in §3.

`POST /internal/warm/host/claim` response (`owner-alpha-warm-claim-v1`):

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-warm-claim-v1",
  "run": { "id": "<uuid>", "current_attempt": 1 },
  "submission_key": "<string>",
  "deadline_at": "<frozen manifest expires_at>",
  "text_only": { "profile_version": "codex-text-only-v1", "profile_sha256": "<hex64>" },
  "manifest": { "admission": 1, "manifest_sha256": "<hex64>", "expires_at": "<ts>" },
  "task_credential": { "grant": { "...WarmTaskGrant..." }, "token": "<task JWT>" }
}
```

### Task (model-facing) — `Authorization: Bearer <task JWT>`

JWT: HS256, `typ: "hehebot-warm-task+jwt"`, `aud: "hehebot-warm-task"`,
`sub: <run_id>`, `grant` = `WarmTaskGrant` (host grant fields plus
`owner_binding_sha256`, `run_id`, `attempt: 1`, `manifest_sha256`).

Allowlist: `agent-routines`, `agent-skill` only. Denied: `agent-command`,
`agent-skill-search`, `question-*`, `steer-result`, all mutations/effects/locks,
manager/host routes. Requests must carry the exact admitted run/attempt; foreign
runs, attempts, and nested child/operation targets are denied. The text-only
policy keeps the captured persona policy/enabled-skill checks; no MCP or native
tool is installed in Stage A. Host credentials cannot reach these routes and vice
versa; no static/legacy/manager fallback exists.

## 5. Wake and readiness

- Only the **first** persisted admitted message creates the once-only
  `owner_alpha_wake:{epoch}` intent, under exact generation identity
  (BOOTING, same epoch/boot/transition, live lease, next-claimable run).
  Reuse of the existing authenticated wake sender and no-replay rules.
- Passive reads and the second message in an already READY generation create no
  new wake intent, hold, or boot.
- The second admission additionally requires a **live executor lease**
  (`lease_until > now`): an expired lease under a still-READY, unexpired
  generation refuses the message without creating a manifest, reservation, run,
  or wake intent.
- Manager generation read returns launch authority only while BOOTING+live;
  READY or retired returns `null` (never a second launch envelope).
- Runtime status identifies the warm generation via the
  `owner_alpha_warm_generation` discriminator (legacy summary keeps
  `owner_alpha_generation`).

## 6. Owner summary (`/v1/state`, `summary.owner_alpha_warm`)

```json
{
  "schema_version": 1,
  "kind": "owner-alpha-warm-summary-v1",
  "policy_revision": "...", "persona_id": "<uuid>",
  "policy_expires_at": "<always the configured absolute expiry, never rewritten on first send>",
  "max_admissions": 2, "admissions_used": 1,
  "message_admission_available": true,
  "generation": { "session_id": "<uuid>", "expires_at": "<ts>", "epoch": 2 }
}
```

`policy_expires_at` is the **policy** bound (config absolute); `generation`
carries the **generation** bound (frozen whole-generation expiry) so first
activation is not misread as policy renewal. `generation` is `null` before the
first admission. `admissions_used` counts durable admitted manifests.
`message_admission_available` is the authoritative gate; passive reads assign
nothing. While warm mode is configured or retained, legacy
`owner_alpha_session`/`owner_alpha_bootstrap` summary fields are unavailable.

## 7. Fail-closed removal and bounded lifetime

Removing `HEHEBOT_OWNER_ALPHA_WARM_GENERATION` never downgrades and never
becomes replacement authority: the persisted config row keeps custody
reconstructible when the exact configuration returns, the summary stays
retained, manager retirement stays available, and legacy routes stay 404. A
candidate owner message for the retained generation persona is **rejected**
before any event, run, or reservation is created (`CAPABILITY_UNAVAILABLE`),
both while the generation is still live and after expiry. A changed warm
configuration, or one naming a different authenticated owner, fails
initialization with `INVALID_CONFIGURATION` and no writes. Stage A admits
exactly one warm revision and no successor revision; retirement is terminal
for this bounded version.

## 8. Deterministic host credential

The host credential's `issued_at` is frozen at the generation's activation
(first admission), not at manager read time: repeated launch reads at different
times return the byte-identical envelope with zero writes.
