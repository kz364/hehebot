# Accounts, authentication, and deployment checklist

No deployment or authenticated inference has been completed. Credentials were locally verified, but that does not prove deployment permission, model eligibility, refresh, live provider behavior, or connector effects. Never paste tokens, OAuth/device codes, QR codes, or personal data into documentation, prompts, or logs.

## Required boundaries

1. **Sprites:** use one organization and one persistent Sprite for all personas. Use a dedicated revocable deployment/runtime token with the narrowest available scope. Verify billing terms and current costs before provisioning.
2. **Cloudflare:** configure the Worker/SQLite Durable Object, owner-only Access application, and a separate service-auth policy for runtime-only internal routes. Verify issuer, audience, signature, exact owner subject, origin checks, and negative cases.
3. **Application credentials:** deployment credentials, runtime bearer, wake token, connector credentials, and model auth are separate domains. Store secrets in platform/private stores with least privilege. New environment variables use `HEHEBOT_`; the wake request uses `x-hehe-wake-token`.
4. **Codex:** install app-server 0.154.0 and complete the supported owner-authorized ChatGPT login in the same persistent runtime environment that executes work. Follow [Codex runtime setup](CODEX_RUNTIME_SETUP.md). Verify account/model availability, no inherited API key or paid fallback, one bounded no-tools turn, restart continuity, later refresh, quota behavior, and concurrent refresh ownership separately.
5. **Connectors:** authorize each installation-owned account once and expose only scoped host tools. Catalog listing, enabled state, callable methods, OAuth scopes, and authorized effects are separate checks.

## Connector gates

- **Google:** select the exact account and calendar IDs. Gmail routines require read/label behavior but no sending; because broad grants may permit sending, enforce no-send at the trusted tool boundary. Calendar read availability does not prove write support. Test wrong-account/calendar rejection and a reversible synthetic event before real writes.
- **WhatsApp:** bind one shared account and exact approved chat; do not broaden to all chats. Measure catch-up after sleep and preserve explicit coverage gaps/watermarks. Routines do not send messages by default.
- **Mac Messages/device:** use a supported read-only bridge in the actual process context with explicit OS permissions. Mac-offline work parks without keeping the Sprite awake. Pairing/availability does not prove history coverage or permission.
- **Webhooks:** unique per-source HMAC secrets, bounded timestamps, stable event IDs, exact-body signatures, and durable deduplication. Never create a broad auth exception.

## Promotion evidence

Before enabling execution, prove valid and invalid portal/runtime/wake authentication, secret redaction, isolated model auth, no paid fallback, connector scope enforcement, restart/refresh, exact effect receipts, full child/tool/effect settlement, and selected-provider holds. Imported routines remain disabled until account mappings, timezone, policy, and next runs are reviewed. Production flags stay false until all applicable S/O gates pass.
