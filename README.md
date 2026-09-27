# Hehebot — portable sleeping assistant

Hehebot is a personal-assistant control plane with a dedicated portal, durable Cloudflare Worker/SQLite state, scheduled work, scoped memory, task metadata, effect receipts, lifecycle fencing, and a replaceable execution boundary. One customer-owned cloud runtime hosts all personas; the runtime may sleep while the control plane continues accepting messages and schedules.

The only supported execution harness is **Codex app-server 0.154.0**. Fly Sprites is the selected initial runtime provider. The selected Mac client is **SwiftUI + WKWebView** around the shared remote portal, with source in `macos/` but native Mac acceptance still unverified. The existing Electron shell is reference-only. Neither client runs an agent locally.

**Current status:** the protected cloud portal has demonstrated canonically completed bounded text-only replies, including a Worker-triggered wake and authenticated reload. Historical failed work remains recovery-required. Message-triggered fresh-session staging is local and default-off; this is not ongoing chat availability or production operation. Production execution gates remain false. A root Codex turn completing is not proof that tools, children, effects, output delivery, or persistence have settled. See TODO for current evidence and blockers.

**Architecture direction (2026-09-27):** [Hehebot v2 execution architecture](docs/ARCHITECTURE_V2.md) is normative.
- Agents reply through a committed `hehebot_send_message`.
- Stale executors are fenced by epoch instead of proving they died.
- Interrupted turns are terminal and continue as new attempts.
- Coordinators route with task tools.
- The portal uses a durable outbox and a streamed timeline.

Work is tracked as the V rows in [TODO.md](TODO.md). [Reference patterns](docs/REFERENCE_PATTERNS.md) explains where each decision comes from.

## Start here

- **[Current handoff](docs/HANDOFF.md)** covers the v2-architecture resume (2026-09-27): where to start, the code map and the current state. Work is on the `v2-architecture` branch (from `source-custody`), not `main`.
- **[Progress and TODO](TODO.md)** — completed local work, remaining tasks, next priority, verification and owner/account/device blockers; updated at implementation checkpoints.
- [Agent model: personas, background tasks, and shared accounts](docs/AGENT_MODEL.md) — diagram and explanation of who controls what
- [Implementation status](docs/IMPLEMENTATION.md)
- [Agent handoff](docs/HANDOFF.md)
- [Product specification](SPEC.md), [UX requirements](PRODUCT_UX_SPEC.md), and [project intent](docs/PROJECT_INTENT.md)
- [Codex runtime setup](docs/CODEX_RUNTIME_SETUP.md)
- [Account and deployment checklist](docs/AUTH_SETUP.md)
- [Bot setup](docs/BOT_SETUP.md), [routine instructions](docs/BOT_ROUTINE_INSTRUCTIONS.md), and [orchestration acceptance](docs/BOT_ORCHESTRATION_ADDENDUM.md)

## Local verification

```sh
bash .agents/setup
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
```

The verification script installs/probes the pinned Codex runtime, runs credential-free control/runtime/HTTP fixtures, and performs a build dry run. Scripted loopback responses do not establish authenticated inference, model judgment, production settlement, live provider behavior, connector permissions, Mac hardware behavior, or production readiness. Do not rely on historical exact test totals; report the output of the current checkout.

For local portal development, run `npm ci`, `npm run types`, and `npm run dev`. Local authentication bypass is loopback-only and must never be exposed publicly.

Private credentials, OAuth state, personal profiles/exports, local databases, browser state, logs, dependencies, and build caches are excluded from Git. Each installation authorizes its own model and connector accounts; no paid API fallback or credential sharing is implicit.
