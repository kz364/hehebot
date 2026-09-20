# Hehebot setup

The protected control plane has demonstrated bounded hosted replies and authenticated reload; this is not an operational assistant. Historical failed custody remains recovery-required. Current Stage A/Stage B local work is not automatically deployed. Provider containment, full lifecycle settlement, connector effects and Mac hardware acceptance remain open; see [current progress](TODO.md).

## Credential-free development

```sh
bash .agents/setup
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
```

For local portal development:

```sh
npm ci
npm run types
npm run dev
```

The local owner-auth bypass accepts loopback only. Do not expose it through a tunnel or portal.

## Live setup order

For an existing installation, inspect retained custody and use the [bounded owner
trial procedure](docs/AUTH_SETUP.md#next-bounded-owner-trial-preparation-and-stop-conditions)
before making changes. Do not repeat provisioning or reset an expired generation
to follow the initial setup order below. Local preparation is not live authorization.

1. Prepare one Fly Sprite and persistent private state; do not create one runtime per bot.
2. Configure Cloudflare Worker/SQLite Durable Object and owner-only Access.
3. Create separate least-privilege deployment, runtime-to-control, and wake credentials. Use the `HEHEBOT_` environment namespace and `x-hehe-wake-token`; never print or commit values.
4. Install and verify Codex app-server 0.154.0 in the same environment that will execute work. Follow [Codex runtime setup](docs/CODEX_RUNTIME_SETUP.md).
5. Complete owner-authorized ChatGPT login there, prohibit API-key fallback, then separately verify inference, restart continuity, and eventual refresh.
6. Bind and test each connector/account/scope independently before enabling its routines. Imported routines remain disabled until reviewed adoption.
7. Prove complete activity, child/tool/effect settlement, exact cancellation, warm/cold wake, backup/restore, and cost gates before enabling production execution or auto-sleep.

See [authentication](docs/AUTH_SETUP.md), [bot setup](docs/BOT_SETUP.md), and [implementation status](docs/IMPLEMENTATION.md). Repository rollback cannot undo cloud resources, account grants, or external effects; drain, reconcile unknown effects, checkpoint, stop the old executor, and restore only into a single fenced owner.
