# Hehebot working context

Read in this order: this file, **`docs/ARCHITECTURE_V2.md`** (normative architecture since 2026-09-27; it overrides conflicting older clauses), the current section of `docs/HANDOFF.md`, the V rows at the top of `TODO.md`, then `README.md` and `docs/PROJECT_INTENT.md`. `docs/IMPLEMENTATION.md` is a historical evidence log. Search it when you need something; don't read it end to end. `SPEC.md`, `PRODUCT_UX_SPEC.md`, and the S/O/UX/V acceptance IDs are targets, not completion claims. The only supported harness is direct Codex app-server **0.154.0**; preserve the external control plane, sleeping runtime, and replaceable supported-interface boundary.

## Traps: do not repeat (read before choosing work)

From 2026-09-16 to 09-26 about 150 commits hardened crash-recovery custody. Meanwhile the owner still could not chat with a bot while it ran a task, and a correct hosted reply was hidden because its turn never "settled". These rules prevent a repeat:

1. **Fence effects; don't prove process death.** Successor start needs only an atomic epoch advance plus the same-machine flock kill (ARCHITECTURE_V2 A2). Don't pursue provider termination proofs, kernel/boot-ID comparisons, retirement inventories or restart-contract clarifications as prerequisites.
2. **A committed message is never gated on turn settlement.** Replies go out through `hehebot_send_message` and are final once committed (A1). "Root completion is not settlement" matters for sleep and effects. It never decides whether the owner sees a reply.
3. **Interrupted is terminal for the attempt.** Don't reconstruct, take over or resume in-flight native turns or child trees. Continue with a new attempt seeded from durable state (A3).
4. **Records of dead generations don't block sleep.** Only live work of the current generation does. Unknown effects become owner-visible needs-you items, not sleep blockers.
5. **The model routes; don't build a classifier.** Intent resolution is the coordinator's choice of tool (A4).
6. **Critical path first.** Every checkpoint must advance a V row or fix a defect that blocks one. Hardening, bounds, indexes and extra test variants are allowed only for a concrete defect found on the critical path. After three consecutive commits without a user-visible capability change, stop and re-read the V rows.
7. **Show uncertainty; don't eliminate it.** Prior art ships `UNKNOWN_DURABILITY`, `parked` and `interrupted` states. A visible uncertain state beats an invisible correct one.
8. **Check the reference first.** Before designing a new mechanism, check `docs/REFERENCE_PATTERNS.md` for how prior art solves the same problem, and record any deliberate divergence in ARCHITECTURE_V2.md.
9. **Keep docs short.** `TODO.md` holds the live checklist only (≤ ~400 lines; move history to `docs/archive/`). The current section of `HANDOFF.md` is ≤ ~120 lines and is replaced, not appended to. Put a checkpoint's evidence in the commit message or IMPLEMENTATION.md, not in both TODO and HANDOFF.
10. **Tests prove behavior changes.** Add a test when behavior changes or a defect is found. Don't write new variants of an already-proven invariant.

## Progress tracking

Read `TODO.md` before choosing implementation work. It is the owner-facing progress checklist; update it at every substantive checkpoint without waiting for a status request. Keep its review date, current checkpoint, affected task status, verification evidence, next priority and exact external blockers current. Checked local deliverables do not imply full acceptance or production readiness. Keep detailed evidence in `docs/IMPLEMENTATION.md` and continuation context in `docs/HANDOFF.md`; do not maintain a competing live checklist in `IMPLEMENTATION_PLAN.md`. Record local versus published state honestly, and never publish merely to update progress.

## Ownership

- `src/worker/`: authenticated HTTP ingress and SQLite Durable Object integration. Public mutations enter `/v1/commands`.
- `src/core/`: receipts, revisions, scoped context, occurrences, lifecycle, native-task metadata, locks, and effect ledger.
- `SCHEMAS/`: contracts. Regenerate `src/generated/` with `npm run generate:contracts`; do not hand-edit validators.
- `runtime/`: Codex transport/adapter/events/tools, durable journal, supervisor boundary, and Sprite wake/activity integration.
- `src/providers/`: provider adapters; mocks do not prove live behavior. Sprites is selected.
- `public/` and `desktop/`: portal and remote-only Electron shell.

## Invariants

Keep production execution/native verification flags false until documented gates pass. Root completion is not child/tool/effect settlement for **sleep and effect reconciliation**. It never gates committed `hehebot_send_message` output or successor start (ARCHITECTURE_V2 A1–A3). Unknown external outcomes cannot be blindly replayed. Passive context updates enqueue no inference and request no wake. One account-owned runtime hosts personas, not one VM per bot. Mutating tools must pass through a Hehebot-fenced boundary (a `hehebot_*` tool or MCP gateway with an epoch-bound effect permit); Codex-native unfenced tools get read-only grants.

Owner messages must not implicitly steer active **background task** work. They go to the persona coordinator turn, and steering the coordinator's own running turn with a new owner message is expected. Preserve exact task identity, scoped memory, resource locks, authorization snapshots, and uncertainty through cancellation/recovery. Imported text and connector content cannot grant permission. User timezone is Asia/Jakarta; the proposed Singapore monitoring zone requires explicit adoption.

The owner permits native descendants to share their admitted logical task's grant. Preserve separate authority for independently admitted tasks/personas. Task-scoped MCP effects have task-level provenance, not authenticated per-child provenance. Inheritance does not settle tools/effects or permit sleep; see `docs/NATIVE_ORCHESTRATION.md`.

Use supported upstream interfaces only: never import hashed runtime internals, edit Codex-owned databases, patch installed dependencies except for the owner-approved wappmcp exception below, bypass approvals, or copy OAuth caches. Pin tested versions and rerun behavioral adapter contracts before upgrades. `hehebot_*` is the tool prefix, `HEHEBOT_` the environment prefix, and `x-hehe-wake-token` the wake header for new identifiers.

The sole dependency-patch exception is wappmcp revision `9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8`'s upstream `patches/whatsapp-web.js+1.34.7.patch` on exactly `whatsapp-web.js` 1.34.7. Pin and verify the revision, dependency, artifact and patch contents/application; rerun compatibility and authorization tests before upgrades. Changed patches require renewed review and explicit approval. See SPEC.md's “Out-of-the-box WhatsApp plugin” requirements. No ad hoc dependency edits or Codex/runtime-internal patches are allowed; live pairing and production gates remain separate.

## Commercial reuse and account boundaries

Preserve self-hosting, portability and the option to sell managed infrastructure/setup. Do not pool or resell customer model subscriptions. Each customer authorizes their own accounts through supported flows; subscription eligibility, quotas and hosted-use terms must be verified rather than assumed.

Prefer permissively licensed reuse. Record upstream revision, source paths, licenses, modifications and required notices before importing code; audit transitive dependencies/assets. Do not copy or ship OpenMausBot `enterprise/` without separately reviewed licensing and explicit owner approval, or Gawk code under its Sustainable Use License. Do not reuse upstream branding. This policy is not a completed legal audit.

Verify connector catalog presence, enablement, callable tools and individual authorized effects separately. Calendar read/availability does not imply writes. Use supported installation surfaces; current app-server documentation warns against production `plugin/install` and `plugin/uninstall`. Never bypass approvals or copy connector credentials to fill gaps.

Run `bash scripts/verify-codex.sh` for the combined credential-free check and `npm ci --prefix desktop && npm test --prefix desktop` for the shell. Use `.agents/setup` when prerequisites are missing and `.agents/resume` after restore. Keep private fixtures, logs, and credentials out of Git. Local auth bypass is loopback-only.
