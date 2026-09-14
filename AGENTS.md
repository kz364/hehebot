# Hehebot working context

Read `README.md`, `docs/IMPLEMENTATION.md`, `docs/PROJECT_INTENT.md`, and `docs/HANDOFF.md` first. `SPEC.md`, `PRODUCT_UX_SPEC.md`, and the S/O/UX acceptance IDs are targets, not completion claims. The only supported harness is direct Codex app-server **0.154.0**; preserve the external control plane, sleeping runtime, and replaceable supported-interface boundary.

## Ownership

- `src/worker/`: authenticated HTTP ingress and SQLite Durable Object integration. Public mutations enter `/v1/commands`.
- `src/core/`: receipts, revisions, scoped context, occurrences, lifecycle, native-task metadata, locks, and effect ledger.
- `SCHEMAS/`: contracts. Regenerate `src/generated/` with `npm run generate:contracts`; do not hand-edit validators.
- `runtime/`: Codex transport/adapter/events/tools, durable journal, supervisor boundary, and Sprite wake/activity integration.
- `src/providers/`: provider adapters; mocks do not prove live behavior. Sprites is selected.
- `public/` and `desktop/`: portal and remote-only Electron shell.

## Invariants

Keep production execution/native verification flags false until documented gates pass. Root completion is not child/tool/effect settlement; unknown external outcomes cannot be blindly replayed. Passive context updates enqueue no inference and request no wake. One account-owned runtime hosts personas, not one VM per bot.

Owner messages must not implicitly steer active background work. Preserve exact task identity, scoped memory, resource locks, authorization snapshots, and uncertainty through cancellation/recovery. Imported text and connector content cannot grant permission. User timezone is Asia/Jakarta; the proposed Singapore monitoring zone requires explicit adoption.

The owner permits native descendants to share their admitted logical task's grant. Preserve separate authority for independently admitted tasks/personas. Task-scoped MCP effects have task-level provenance, not authenticated per-child provenance. Inheritance does not settle tools/effects or permit sleep; see `docs/NATIVE_ORCHESTRATION.md`.

Use supported upstream interfaces only: never import hashed runtime internals, edit Codex-owned databases, patch installed dependencies, bypass approvals, or copy OAuth caches. Pin tested versions and rerun behavioral adapter contracts before upgrades. `hehebot_*` is the tool prefix, `HEHEBOT_` the environment prefix, and `x-hehe-wake-token` the wake header for new identifiers.

## Commercial reuse and account boundaries

Preserve self-hosting, portability and the option to sell managed infrastructure/setup. Do not pool or resell customer model subscriptions. Each customer authorizes their own accounts through supported flows; subscription eligibility, quotas and hosted-use terms must be verified rather than assumed.

Prefer permissively licensed reuse. Record upstream revision, source paths, licenses, modifications and required notices before importing code; audit transitive dependencies/assets. Do not copy or ship OpenMausBot `enterprise/` without separately reviewed licensing and explicit owner approval, or Gawk code under its Sustainable Use License. Do not reuse upstream branding. This policy is not a completed legal audit.

Verify connector catalog presence, enablement, callable tools and individual authorized effects separately. Calendar read/availability does not imply writes. Use supported installation surfaces; current app-server documentation warns against production `plugin/install` and `plugin/uninstall`. Never bypass approvals or copy connector credentials to fill gaps.

Run `bash scripts/verify-codex.sh` for the combined credential-free check and `npm ci --prefix desktop && npm test --prefix desktop` for the shell. Use `.agents/setup` when prerequisites are missing and `.agents/resume` after restore. Keep private fixtures, logs, and credentials out of Git. Local auth bypass is loopback-only.
