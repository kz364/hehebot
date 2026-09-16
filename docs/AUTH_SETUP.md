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

Access installations now persist an `installation_owner` binding in application
`runtime_metadata` before seeding. It pins auth mode, installation ID, exact issuer,
audience and owner subject. Reconstructing with a different binding, including a
downgrade to local auth, fails with `OWNER_MIGRATION_REQUIRED`. Fresh invalid
Access configuration writes nothing. Existing populated unbound databases cannot
silently acquire a new owner; they require an explicit migration workflow, which
is not implemented. Do not delete the binding to bypass this refusal. Existing
unbound local installations remain unchanged. Application export/import retains
the binding but still grants no restore activation authority.

The authenticated internal `status` response includes `owner_binding_sha256` for
bound Access installations only. Local/alpha status shapes and public state are
unchanged. The digest is SHA-256 of the UTF-8, compact `JSON.stringify` encoding of
this object in this exact key order, using the reviewed configured strings:

```js
{ auth_mode: 'access', installation_id: INSTALLATION_ID,
  issuer: ACCESS_ISSUER, audience: ACCESS_AUD, owner_subject: OWNER_SUB }
```

Set the transport-only Sprite preflight's required `ownerBindingSha256` to the
independently computed lowercase64-hex digest. Do not learn/trust a new expected
owner merely by copying the response from the server being checked. Its existing
ControlClient pins the HTTPS origin and rejects redirects; the preflight captures
configuration before awaiting status and compares the digest before reporting
`owner_binding_verified:true`. Reports contain neither binding fields nor hashes.
Missing/mismatched binding produces generic reconciliation failure. HTTP202 means
only that the wake was accepted, not that the asynchronous check passed. Even a
match reports `executor_ready:false`; this entrypoint cannot boot, claim, create
activity holds or invoke a model. Actual hosted execution must separately persist
and enforce its expected identity before admission; this check does not enable it.

The runtime composition now accepts explicit `hostedOwnerBindingSha256` alongside
`ownerAlpha`, both private Access credential file references, and a supplied
Sprites Tasks client. It persists `{bindingSha256, origin}` in the fresh service
journal before status, compares the authenticated owner digest before boot, and
requires confirmed activity custody before version checks, native preparation,
launch and subsequent admission. Hold expiry refuses reacquisition; stop retains
the Task and unknown work. The expected digest must be computed independently as
above. Configuration is captured before awaits; retained state cannot reboot.
The Worker has a distinct, default-absent `HEHEBOT_HOSTED_OWNER_ALPHA` binding:

```json
{"owner_binding_sha256":"<independently computed lowercase 64-hex digest>","policy":{"session_id":"<fresh UUID>","persona_id":"<selected persona UUID>","expires_at":"<canonical UTC deadline>","max_runs":1,"max_task_seconds":120}}
```

It requires Access auth, both production flags false, `PROVIDER_CONFIG:{}` and
no local `HEHEBOT_OWNER_ALPHA`. The policy has the same bounds and optional
`background_first_root:true` as local alpha. Pin mismatch rolls back initial owner
binding before seeding. Existing quota/attempt custody remains immutable: changing
or removing the policy does not reset it. Internal status adds
`owner_alpha_hosted:true`; hosted runtime requires it, while local/test runtime
rejects it. Public/local status shapes remain unchanged. The empty provider config
deliberately disables automatic wake; Sprite holds are owned by the runtime.

`runHostedOwnerAlpha` is a supervised composition API using the existing Sprite
Tasks client and the same account/model checks, no-paid-fallback restrictions and
deadline watchdog as local alpha. Build the provider module with
`bash scripts/build-codex-service.sh` before composing it. Its caller must hold the
kernel executor lock for the complete process tree. The manual launcher is:

```sh
node runtime/hosted-owner-launcher.mjs --run /absolute/private/operator-config.json
```

Run this only on the explicitly authorized runtime, after the hosted integration
and account/provider checks. It requires distinct existing private `nativeHome`
and `stateDirectory` directories, locks the native home first and session second,
then hands the child an exact config digest. A changed config refuses before
account work. Exit73 means lock contention; it is not a retry instruction. Signals
forward to the one launched child; retained state is never reset. The internal
`--run-hosted-locked` mode is a launcher handoff, not an alternative entrypoint.
Do not replace locked directories or invoke the composition API without its locks.
No HTTP wake activation was added; the Sprite HTTP entrypoint stays transport-only.
The local entrypoint rejects the hosted field. No deployed binding or default
configuration selects this mode. Local alpha stays loopback-only/provider-free.
This is local fixture evidence, not permission to launch a hosted trial.

**Lock limitation:** Node's default child spawn drops extra descriptors. A bounded
pristine0.154.0 experiment observed explicitly inherited lock custody in the npm
wrapper, but not in its native ELF child. The launcher therefore proves exclusion
only while its cooperating lock owner survives; it does not prove native descendant
termination after wrapper loss. Never start replacement work merely because a lock
is free. Preserve unknown custody and resolve provider/process containment separately.

Source check, 2026-09-17 Asia/Jakarta: the official
[authentication documentation, CLI/headless section](https://developers.openai.com/codex/auth.md)
explicitly supports ChatGPT device-code login on remote/headless machines and
also recommends API keys for programmatic automation. This establishes a supported
same-owner login mechanism, not blanket subscription eligibility for unattended
hosted workloads or managed resale. Hehebot still forbids paid API fallback and
copying OAuth caches, including the cache-copy fallback described upstream. Use
supported login on the actual executing runtime; verify its account/model/limits
separately. Current web documentation is not proof every new feature exists in
the pinned 0.154.0 binary.

The bounded hosted composition reuses command, quota, deadline and native-custody
paths. Its invariants and remaining live gates are:

- Bind the operator's expected owner/installation and exact control origin into
  the runtime's fresh session intent and verify them against authenticated control
  status before boot. A valid runtime bearer is not permission to select another
  owner. Do not expose credentials in the status response.
- Retain the owner-alpha no-replay/no-sleep/no-effects limits and immutable quota.
  Keep this mode distinct from both local alpha and production; merely permitting
  Access in the local parser is insufficient. No hosted deployment is enabled.
- Require the existing Sprite activity guard instead of the local alpha's no-op
  guard. Verify hold receipt/renewal before admission and reconcile a lost/expired
  hold without restarting inference. A hold prevents idle freeze; it is not a
  protected termination boundary or evidence of settlement.
- Require supported sandbox/credential isolation on the actual provider and one
  refresh owner. End the bounded trial with retained unknown obligations; do not
  promise autonomous recovery or release holds as though root completion settled
  descendants. Provider-specific behavior still needs authorized live evidence.

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
