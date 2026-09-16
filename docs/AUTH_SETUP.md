# Accounts, authentication, and deployment checklist

No cloud deployment has been completed. Bounded same-owner ChatGPT-backed chat, routine reads, V2 background responsiveness and exact cancellation have been observed in the orb; see [implementation evidence](IMPLEMENTATION.md). That does not prove deployment permission, unattended refresh, live provider containment, or connector effects. Never paste tokens, OAuth/device codes, QR codes, or personal data into documentation, prompts, or logs.

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

## Hosted-trial preparation is not alpha promotion

The existing owner alpha is a **local, supervised, fresh installation** behind
the authenticated gateway. `parseOwnerAlpha` requires local auth, empty provider
configuration and both production flags false. Copying its policy into a deployed
Cloudflare Worker using Access is rejected; do not remove that check or set
production flags to make the trial start. The earlier orb trial is not a deployed
Cloudflare/Sprite architecture.

Before requesting a concrete hosted deployment, prepare these inputs locally:

| Input | Required review / current boundary |
| --- | --- |
| Exact release and target | Record the reviewed local revision, Worker name, account, hostname and existing Sprite reference. Local commits are not necessarily on origin/main. Do not upload retained alpha databases, native journals or credentials as deployment assets. |
| Owner ingress | Use `AUTH_MODE=access`, exact issuer/audience/owner subject and HTTPS origin. Keep `workers_dev:false`; no unprotected alternate route. Wrong owner, issuer, audience, expiry and forged forwarded headers must reject. Never proxy the local bypass directly: URL host checks are not a network ACL. |
| Runtime ingress | Separate runtime bearer, wake token and Access service credentials from browser identity. Review internal-route policy and logs independently; a working owner login is not runtime authorization. |
| Execution mode | Initially preserve `EXECUTION_ENABLED:false`, `NATIVE_VERIFIED:false` and `lifecycleVerified:false`. The current local alpha cannot serve as a hosted execution mode. A hosted bounded mode needs a separately reviewed authenticated admission boundary, not a configuration workaround. |
| Model account | The customer signs in through the supported flow on the selected persistent runtime. Do not copy the orb's OAuth cache or run concurrent refresh owners. Verify subscription eligibility and hosted-use terms; no paid API fallback. |
| Provider lifecycle | Resolve the [protected containment question](PROVIDERS.md) and verify holds, generation fencing, cold/warm behavior and exact stop evidence before autonomous sleep/replacement. Existing read-only Sprite inspection did not grant mutation/deployment. |
| State and rollback | Identify private persistent paths, backup/key custody and the single executor. Rollback stops admission and preserves unknown work; it must not delete/reset custody or automatically replay a retained alpha session. Application-only backups do not restore native authority. |
| Authorization and cost | Request the exact deployment/lifecycle actions against named targets with a bounded incremental cost. Existing trial grants and the completed Sprite inspection are not renewed budgets or deployment permission. |

Credential-free preparation commands are `bash scripts/verify-codex.sh` and
`npm run build` (the latter uses `wrangler deploy --dry-run`, not deployment).
Inspect the selected configuration and dry-run bindings; do not use `--env local`
for a cloud deployment. Run owner/runtime negative-auth tests before promotion.
Neither these commands nor a checklist pass authorizes publishing, changing Access,
provisioning, waking/mutating the Sprite, installing a model account or enabling
production. Track each live acceptance result separately in TODO/IMPLEMENTATION.
