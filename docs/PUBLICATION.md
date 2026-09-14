# Hehebot repository publication snapshots

Current destination: [kz364/hehebot](https://github.com/kz364/hehebot), private GitHub repository, renamed by the owner on 2026-09-14. Repository metadata and the README use Hehebot; existing application/storage identifiers remain unchanged.

The current publication includes the direct Codex 0.154.0 adapter, durable journal/event routing, exact child cancellation, scoped root dynamic tools and supervisor fixtures, plus accumulated control-plane, desktop and documentation work. Run `bash scripts/verify-codex.sh` for the current credential-free acceptance entrypoint. The independently verified v14 snapshot passed 343 core tests, 99 runtime tests, 4 setup tests, 20 HTTP checks, native lifecycle and three tool/control fixture modes, and typecheck/build dry run. Scripted model responses do not establish model judgment. Child effect grants, recursive settlement and production admission remain unresolved; execution gates stay false.

## Historical 2026-09-13 snapshot

The sections below record the earlier Clawbot/OpenClaw publication and its checks, not the current direct-Codex acceptance status. That snapshot published accumulated code, tests, configuration templates, schemas, full specification and project documentation. It did not deploy the assistant or enable cloud execution.

## What is included

- Cloudflare portal/static assets, authenticated API, SQLite Durable Object controller and scheduler.
- Provider adapters, selected Sprites service/Tasks bridge, native transport/journal and verification gates.
- Reviewed bot-import tooling, five-persona catalog, seven-routine behavior, task cards, scoped memory and flight deadline contracts.
- Unit/integration/runtime/source-check/HTTP tests, dependency lockfile, generated static validators and all project scripts.
- SPEC.md and its complete intent, orchestration and routine supplements, implementation plan, setup/authentication guides, provider research and limitations, original remote/Mac setup documentation.

## Deliberate exclusions

`.local/`, `.env*` (except examples), `.dev.vars*`, provider/runtime secrets, OAuth stores, pairing material, private traveler/identity profiles, raw Grok export, raw test logs, local SQLite/browser state, node_modules and generated build caches are not published. The sanitized full bot instructions preserve behavior with account/calendar/contact identifiers supplied privately during setup. Existing `.local` data remains on the Mac unchanged. This repository is a source/documentation backup, not a backup of connected account sessions or personal identity documents.

## Verification rerun for publication

- `npm test`: **176 passed**.
- `node --test tests/runtime*.mjs tests/bot-import.test.mjs tests/native-orchestration-contracts.test.mjs`: **45 passed** (36 runtime + 4 import + 5 pinned native-source checks).
- `npm run test:e2e`: **20 local Worker/SQLite HTTP checks passed**. Initial restricted run could not bind loopback; rerun with loopback permission passed.
- `npm run build`: **passed**, including contract generation, TypeScript checking and Wrangler dry run. No upload/deployment.
- Source/dependency/config files reviewed for secret patterns and personal identity-number leakage. Ignored private inputs remain excluded; this is a scoped publication review, not a comprehensive security certification.

## Operational status

This is a locally tested foundation. Real native coordinator/child event ingestion and end-to-end O01–O09 behavior remain unverified; the Sprite executable is transport-preflight-only. Production execution, native verification and flight restoration gates remain false. No provider is live verified; accounts/login/connector permissions, browser/mobile acceptance, restore/cost observation and the final executor integration remain outstanding. Unit tests do not establish operational readiness.

GitHub publication was explicitly authorized by the owner. Repository visibility must be checked PRIVATE before pushing, and local HEAD must match the remote main branch afterward. No global Git settings are changed.
