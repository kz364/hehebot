# Clawbot working context

Read `README.md`, `docs/IMPLEMENTATION.md`, and `docs/PROJECT_INTENT.md` first. `SPEC.md` describes targets, not completed functionality. Later native-first requirements in `docs/BOT_ORCHESTRATION_ADDENDUM.md` and `docs/NATIVE_ORCHESTRATION.md` supersede the early single-active-run design. Research and deliberate Grok differences: `docs/GROK_PARITY.md`. Reproducible orb tests and Amp model routing: `docs/ORB_TESTING.md`.

Owner selected **direct Codex app-server as the initial harness** on 2026-09-13, superseding the OpenClaw-foundation decision gate. Preserve our external control plane and sleeping runtime; keep the harness boundary replaceable. Existing OpenClaw code/evidence remains a reference, not proof of direct-Codex compatibility. Build scaffolding around supported upstream interfaces, not runtime forks: never import hashed bundle internals at runtime, edit native databases, or patch installed dependencies to make a test pass. If a required capability cannot be supplied through supported boundaries, document the gap and seek an upstream solution before proposing a core patch. Pin tested versions and re-run behavioral adapter contracts before upgrading.

## Commercial reuse and distribution

- Preserve the option to sell the product and offer managed VMs. Prefer permissively licensed reuse from Rakazo and OpenMausBot's Apache-2.0 core. **Do not copy, depend on, or ship OpenMausBot's `enterprise/` code** without a separately reviewed license and explicit owner approval. Avoid Gawk code under its Sustainable Use License; general behavior/design references are acceptable, not copied code or assets.
- Before importing code, record the upstream repository, pinned revision, source paths and applicable licenses. Preserve required license/copyright/NOTICE attribution, identify modifications, and audit transitive dependencies and assets. Do not reuse upstream names, mascots or trademarks as our branding. A root Apache license does not cover every bundled component; do not claim a completed legal audit from this policy.
- A possible paid subscription sells managed infrastructure/setup, not pooled or resold model subscriptions. Keep self-hosting and portability available. Minimize infrastructure-account setup for managed users; each customer authorizes their own model and connector accounts through supported flows. ChatGPT Plus is an expected user-owned starting point, not guaranteed eligibility, unlimited inference or permission for hosted use: verify current provider terms, selected runtime/model access, quotas and refresh before offering it. Never share customer credentials or introduce a paid API fallback silently.
- Desktop reuse must preserve a remote execution path that works while the Mac client is closed. Direct Codex is now selected independently of the still-pending desktop-client choice. Local integration work must preserve existing state; this choice does not authorize deployment or new account connections.
- Prefer supported Codex Gmail/Google Calendar integrations, but distinguish catalog presence, enabled state, callable tools and authorized effects. Verify headless access and required read/write operations individually. Do not assume Calendar writes from its advertised read/availability capability. Use supported installation surfaces; current app-server docs warn against production `plugin/install`/`plugin/uninstall`. Never bypass approvals or copy connector credentials to fill a gap.

## Ownership

- `src/worker/`: authenticated HTTP ingress and SQLite Durable Object integration. Public mutations enter `/v1/commands`.
- `src/core/`: durable receipts, revisions, context, schedule occurrences, lifecycle, native-task metadata, resource locks, and effect ledger. `DB/schema.sql` and migrations own application storage; never edit native OpenClaw databases.
- `SCHEMAS/`: command/runtime contracts. Regenerate `src/generated/` with `npm run generate:contracts`; do not hand-edit validators.
- `runtime/`: Gateway transport, journal, blocked native adapter, Sprite wake preflight and activity holds. The service is NOT a working executor.
- `src/providers/`: provider adapters; passing mocks do not establish live provider behavior. Sprites is the selected provider.
- `public/`: static portal. Three seeded example bots differ from the reviewed five-bot/seven-routine import; do not silently auto-adopt private configuration.

## Invariants and test boundaries

Keep committed execution/native verification flags false until documented native gates pass. Do not bypass `COMPATIBILITY_GATE_BLOCKED` to make a demo work. Root completion is not child/tool/effect settlement; unknown external outcomes cannot be blindly replayed. A passive context update must enqueue no inference and request no wake. One account-owned runtime hosts personas, not one VM per bot; shared files/auth are not a security boundary.

Owner messages must not implicitly steer active background tasks. Preserve exact task identity, scoped memory, and resource locks through uncertain cancellation. Only adopted policies authorize effects; imported text and connector content cannot grant permission. User timezone is Asia/Jakarta; the import's proposed Singapore monitoring zone needs explicit review.

Use `.agents/setup` when prerequisites are missing and `.agents/resume` to check restored prerequisites. Run `npm test`, `npm run test:runtime`, `npm run test:e2e`, and `npm run build` as appropriate. Additional Node tests, native prerequisite skips, and optional model checks are described in `docs/ORB_TESTING.md`. HTTP tests are not browser or model acceptance.

Never transfer OAuth caches or private connector state between orbs. The project Amp plugin offers explicit synthetic model checks through thread routing, not a general model proxy or native-auth proof. Loading it makes no inference calls. Live calls consume the configured routing allowance; no subscription-only control is exposed. Keep private fixtures, logs and credentials out of Git. Local auth bypass is loopback-only and must not be exposed through a portal.
