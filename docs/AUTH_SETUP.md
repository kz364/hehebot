# Sprites + Cloudflare account and authentication checklist

Checked 2026-09-10 against official documentation and this repository. **Sprites is the selected initial runtime.** Cloudflare hosts the always-available portal, API, SQLite Durable Object state and alarms. No account has been connected or billed by this implementation. Steps that create cloud resources remain for a later deployment pass; completing a login does not enable execution.

Do not paste keys, QR codes, OAuth codes or tokens into chat. Use provider login screens, the hidden-input helper below, and platform secret stores. Non-secret account IDs, org names, hostnames and “login complete” are enough to coordinate setup.

## Required now: accounts and deployment preparation

### 1. Fly/Sprites account and eligible trial — you

1. Open [Sprites](https://fly.io/sprites/), choose **Start free**, and sign in/create the intended Fly.io account. Sprites uses that account; a separate Fly Machines deployment is unnecessary.
2. Select the **one organization** that should own this assistant before activating Sprites. Use an otherwise empty organization if its token cannot be narrowed to this project.
3. Activate Sprites for that organization through its onboarding, then check that the dashboard shows the $30 grant. Eligibility is one grant per user and at most one per organization. A second org activated by the same user does not receive another grant. Eligibility has not been checked for your account.
4. Review the displayed billing terms before accepting anything. We have not established a universal no-card requirement, trial expiry or automatic spending cap. Do not select a paid plan or approve automatic paid continuation as part of this checklist. If activation requires a billing commitment, stop at that concrete screen. The provider says credits cover usage, not a monthly subscription fee. [Trial and billing FAQ](https://fly.io/sprites/)

Non-secret verification: chosen org name, visible grant/remaining balance, and whether billing is trial-only or can incur charges. No Sprite is created merely to test login.

### 2. Sprites CLI and API credential — you authorize; agent configures

Install the official CLI from the [installation page](https://docs.sprites.dev/cli/installation/) if it is not already available, then run:

```sh
sprite org auth --org YOUR_ORG
sprite org list
sprite list -o YOUR_ORG
```

The first command opens Fly authentication and establishes the selected org's Sprites token. Keep the default system keyring storage. The docs also offer token creation/management at [sprites.dev/account](https://sprites.dev/account); use that org's token controls for a **separate deployment token**. Do not use a general Fly account token in `PROVIDER_TOKEN`. [Sprites authentication](https://docs.sprites.dev/cli/authentication/)

Scope boundary: the public authentication docs establish org-bound tokens, but do not document a reliable CLI command or exact dashboard controls for per-Sprite/per-method attenuation. **An org token is not proven least-privilege at a single Sprite.** If token policy controls are offered, restrict to the selected Sprite and required read/service-start actions; have the agent inspect and verify the offered policy before relying on it. Otherwise use a dedicated project org and a dedicated revocable token; do not claim finer scopes. Setup may need separate temporary create/exec/filesystem permissions, while steady-state Worker needs observation and service wake only. The runtime's local Tasks API needs no Sprites token.

Store the separately created token with the hidden terminal prompt:

```sh
python3 scripts/setup-secrets.py --store PROVIDER_TOKEN
```

It writes `.local/secrets/PROVIDER_TOKEN` (0600, ignored by Git). At deployment, the agent transfers it through standard input to Worker secret `PROVIDER_TOKEN`. It stays out of `PROVIDER_CONFIG`, portal JavaScript, logs and the Sprite model environment. Login verification uses org/Sprite listings, never printing the token or dumping CLI config. The exact dashboard token-policy UI remains unobserved.

### 3. Cloudflare account, account ID and deployment access — you

1. Sign in/create the intended [Cloudflare account](https://dash.cloudflare.com/). Enable Workers and Zero Trust using a suitable free tier if offered; do not approve an upgrade silently. SQLite-backed Durable Objects are available on Workers Free, subject to limits; this app's actual production CPU/storage fit is not yet measured. [Durable Objects plans](https://developers.cloudflare.com/durable-objects/platform/pricing/)
2. Copy the **Account ID**: dashboard search (`Cmd-K`) → `Copy account ID`, or Workers & Pages → Account Details. This ID is not a secret. There is no zone ID requirement when using `workers.dev`. [Account ID instructions](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
3. Create a deployment token: **My Profile → API Tokens → Create Token → custom token**. Name it `claw-personal-deploy`, scope account resources to this account, and set an appropriate expiry. Store it through `python3 scripts/setup-secrets.py --store CLOUDFLARE_API_TOKEN`. [Token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

For this direct Wrangler deployment, start with:

| Permission | Purpose |
| --- | --- |
| Account → Workers Scripts → Edit (API calls it Write) | Worker/module upload, static assets associated with the Worker, bindings/migrations, and Worker secret management |
| Account → Account Settings → Read | Wrangler account/settings discovery |

Worker upload accepts Workers Scripts Write and includes Durable Object migrations/bindings. There is no separate database password or runtime Cloudflare management token: the Worker accesses its DO and alarms through bindings. This repository does not use D1, KV, R2, Queues, Pages or Workers Builds; do not add their edit scopes preemptively. The token scope set is documentation-derived and must still be verified against the account during deployment. [Worker upload contract](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/), [permission names](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

For local verification in a private terminal:

```sh
export CLOUDFLARE_ACCOUNT_ID='YOUR_ACCOUNT_ID'
export CLOUDFLARE_API_TOKEN="$(cat .local/secrets/CLOUDFLARE_API_TOKEN)"
npx wrangler whoami
```

No `set -x`, environment dump or token output. The deployment token is held on the operator machine or a later CI secret store, **never inside the Worker or Sprite**. Browser-based `npx wrangler login` is an alternative to maintaining a deployment API token; it prompts for Wrangler's OAuth permissions and is not the same narrowly configured token. Do not perform both unnecessarily. `wrangler whoami` is read-only and confirms account identity; a successful identity check alone does not prove every deployment permission.

### 4. Portal login and provider hostname — you choose identity; agent wires settings

A custom domain is optional. Use `claw-personal-portal.YOUR_SUBDOMAIN.workers.dev` initially, protected by Access. Cloudflare documents Access protection for `workers.dev`; the repository currently sets `workers_dev:false` and will only enable the route during an authorized deployment. Preview routes must also be protected or disabled. [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

For an owner-only portal with no extra identity-provider client secret:

1. Complete Zero Trust onboarding and record the team hostname (`TEAM.cloudflareaccess.com`).
2. Add **One-time PIN** at Zero Trust → Integrations → Identity providers → Add new identity provider. It is not automatically enabled for new organizations. [OTP setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
3. In Zero Trust → Access → Applications, add a **Self-hosted** application for the portal hostname. Add an Allow policy with **Emails = your exact email**, choose OTP as its login method, and exclude broad domains/everyone. Use hostname/path-based applications so machine routes can have distinct policies. [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
4. Record the application's **Application Audience (AUD)** and team issuer in `ACCESS_AUD` and `ACCESS_ISSUER`. Open its login page and complete the emailed PIN yourself. Obtain the authenticated user's ID/sub through Cloudflare's identity view or `/cdn-cgi/access/get-identity`; configure the exact owner `OWNER_SUB`, not an email substituted for sub. These three values are configuration identifiers, not keys. The Worker independently validates issuer/audience/signature/subject.

Agent verifies: logged-out access is blocked, the intended owner reaches `/v1/state`, a different identity is rejected, and no unsigned identity header works. Until `OWNER_SUB` is configured the Worker deliberately denies access. A separate Google/Okta/OIDC app and client secret are unnecessary for OTP. If you later choose a different identity provider, its admin must authorize that integration separately.

### 5. Runtime-to-portal Access service credential — Cloudflare generates; you/agent store

The Sprite is a machine caller, so it cannot answer a browser PIN challenge. Add a **separate** Self-hosted Access application for `PORTAL_HOST/internal/*` with a Service Auth policy accepting only a dedicated `claw-sprite-runtime` service token. The more-specific path policy must take precedence over the owner portal application. Do not grant this token owner access to `/v1/commands` or the portal.

Create it at **Zero Trust → Access controls → Service credentials → Service Tokens → Create Service Token**; choose an expiry, generate, and save the one-time displayed Client ID and Client Secret using:

```sh
python3 scripts/setup-secrets.py --store CF_ACCESS_CLIENT_ID
python3 scripts/setup-secrets.py --store CF_ACCESS_CLIENT_SECRET
```

The Sprite's control client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`, plus the independent application `Authorization: Bearer RUNTIME_TOKEN`. The service token passes the edge policy; `RUNTIME_TOKEN` authorizes the internal Worker API. Store the pair only in the Sprite supervisor's private configuration, not the model's prompts or source. Verify that valid machine credentials reach the internal API, missing edge credentials are denied, and a wrong application token returns 401. While execution is disabled, a correctly authenticated request can still return `CAPABILITY_UNAVAILABLE`. [Service credentials](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

Dashboard setup requires no extra API token. If automating Access administration later, use a **separate short-lived setup token** with only the selected account's `Access: Apps and Policies Write`, `Access: Service Tokens Write`, and (only if creating OTP) `Access: Organizations, Identity Providers, and Groups Write`. Do not add these to the long-lived deployment/runtime credentials. Confirm current dashboard labels before creation. [Access policy API permissions](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/create/)

### 6. Application secrets — agent generated locally

`python3 scripts/setup-secrets.py --generate` has already created three independent random secrets without printing values. Existing files are preserved; the helper never rotates a deployed secret implicitly.

| Secret | Where it goes | Non-secret check |
| --- | --- | --- |
| `RUNTIME_TOKEN` | Worker secret + Sprite supervisor private config | Positive/negative internal auth checks |
| `SPRITE_WAKE_TOKEN` | Worker secret + Sprite wake service private config | Wrong-token and duplicate-wake checks |
| `GATEWAY_TOKEN` | Native OpenClaw Gateway auth config + loopback executor only | Authenticated local Gateway health; wrong token denied |

Files are in ignored `.local/secrets/`, directory 0700 and files 0600. Local mode/length checks passed. Nothing has been uploaded or applied to live configuration. At deployment, `npx wrangler secret put RUNTIME_TOKEN < .local/secrets/RUNTIME_TOKEN` and the corresponding `PROVIDER_TOKEN` command use stdin; uploading a secret requires an existing authorized Worker and is a live configuration action. Transfer native secrets over authenticated Sprite tooling into a private supervisor-owned state directory. File permissions are not a full security boundary against a same-user model shell: the executor's process/user isolation still needs validation before real secrets reach it.

## Required before inference: OpenClaw-managed OpenAI subscription login

You must complete OpenClaw's interactive OAuth flow **inside the Sprite's persistent state**, not copy the desktop Codex token. There is no paid OpenAI API-key requirement. The pinned 2026.9.3 flow is:

```sh
openclaw models auth login --provider openai --device-code --agent AGENT_ID
```

Use the actual configured agent ID; follow the live OpenAI browser/device instructions and MFA yourself. Then verify effective OAuth profile, model/runtime and absence of API-key fallbacks. Full steps, per-agent routing, store locations and pending restart/refresh tests are in [NATIVE_AUTH_SETUP.md](NATIVE_AUTH_SETUP.md). Public `openai/*` naming alone does not prove subscription billing. [Official OpenAI headless authentication](https://learn.chatgpt.com/docs/auth), [OpenClaw provider setup](https://docs.openclaw.ai/providers/openai/setup)

## Required only when a connector is enabled

- **WhatsApp:** owner scans its Linked devices QR, generated by `openclaw channels login --channel whatsapp` inside the Sprite. No WhatsApp API key is required for this native linked-device path. Keep inbound model routing disabled until the intended policy is configured. Preserve its managed credential directory and test sleep/reconnect catch-up. [Detailed WhatsApp steps](NATIVE_AUTH_SETUP.md#5-shared-whatsapp-linkage-and-exact-family-chat-selection)
- **Shared Google for imported routines:** select one exact account and each target calendar ID. Required grant: `gmail.modify`, `calendar.events`, and `calendar.calendarlist.readonly` for selection. No Gmail send action is authorized; `gmail.modify` nevertheless permits sending at Google's API layer, so trusted tool restrictions are required. The installed gog v0.11.0 defaults also request Gmail settings and full Calendar permissions, and its inspected help lacks exact-scope controls: **do not consent with that default preset**. Narrow integration/version selection is a concrete setup blocker. If gog is selected, OAuth client configuration is required, not a generic API key. [Scope details, commands and verification](NATIVE_AUTH_SETUP.md#7-shared-google-connection-for-imported-routines)
- **Mac Messages routine:** pair the identified Mac and separately establish the actual basic `imsg` reader/official plugin transport. `imsg` is currently absent from the inspected PATH. Full Disk Access must apply to the deployed reader's process context; Grok's grant does not transfer. No send Automation or SIP changes are needed for this read-only task. Establish baseline/watermark and prove sleep/restart history catch-up before enabling. [Reader and coverage gates](NATIVE_AUTH_SETUP.md#8-mac-messages-reader-and-offline-coverage)
- **Other accounts:** choose the actual supported integration before requesting consent. Desktop/ChatGPT connector grants do not automatically carry into the Sprite.
- **External webhooks:** agent generates a unique high-entropy HMAC secret per registered source; configure `TRIGGER_SECRETS` in Worker secret storage and the sending integration's private settings. The current endpoint requires the project's signed raw-body envelope and stable event ID. An arbitrary SaaS webhook will need its own verified adapter. If it cannot use Cloudflare service headers, add a tightly scoped path exception only for that trigger after reviewing its source signature; never bypass portal authentication broadly. No webhook secret is needed now.

## Optional

- **Mac node:** owner approves the identified native device/capabilities and grants the signed app only required macOS permissions. Native private connectivity to a Sprite is not yet established; a Sprites URL or Cloudflare portal login alone does not supply Mac-node authentication. See [pairing and permissions](NATIVE_AUTH_SETUP.md#4-optional-laptop-pairing-and-permissions).
- **Custom domain:** later choose a zone in Cloudflare and configure a Worker Custom Domain. Only then add narrowly scoped zone DNS/route permissions if automating it. No registrar, DNS API key or certificate purchase is required for the initial provider hostname.
- **Sprites managed connectors/MCP:** not required by this implementation. They do not replace OpenClaw's native subscription OAuth; do not activate a managed paid inference connector as a fallback.

## Current implementation and remaining proof

Sprites observation, Service-start response validation and native Tasks upsert/readback/release are implemented with synthetic tests. In-Sprite Unix-socket transport and a bounded renewable activity guard are also present. The guard refuses expired-hold resumption and retains holds when drain proof is incomplete. The controller now has a tested same-Sprite IDLE_PERMITTED path with fresh boot/epoch admission after clean drain. The actual supervisor service, warm-service wake notification and full native executor still need wiring; live warm/cold cycles remain gated. No Sprites key, Cloudflare account, trial grant, OAuth profile, Access policy or connector has been verified for your account. [Provider details](PROVIDERS.md), [implementation status](IMPLEMENTATION.md)

The next user actions are steps 1–3 and selecting the exact portal login email. The next agent actions are non-secret account verification, runtime/Access configuration preparation, and live setup only within the authorization and billing terms you approve.

## Transport preflight artifact and next gates

`config/sprites/supervisor.example.json` is a secret-free configuration example for `runtime/sprites-service-entry.mjs`. Copy the resolved configuration into a private regular file (0600), point `SPRITE_SUPERVISOR_CONFIG` at its absolute path, and provide the named private secret files (0600). A future authorized Sprite service runs `node runtime/sprites-service-entry.mjs` on port 8080. `/wake` requires `SPRITE_WAKE_TOKEN`; the private Sprite URL also requires the organization's provider bearer. It checks `/internal/status` through Access service credentials and application bearer without claiming a job or invoking a model. **This is transport preflight only, not a runnable assistant.**

The remaining implementation gate is native coordinator submission, receipt/event ingestion, complete activity and definitive cancellation/settlement wired to this service. The native source contracts and known limitations are in [NATIVE_ORCHESTRATION.md](NATIVE_ORCHESTRATION.md). Keep `EXECUTION_ENABLED`, `NATIVE_VERIFIED`, provider `lifecycleVerified` and `FLIGHT_RESTORE_VERIFIED` false until their respective live checks pass. Configure `NATIVE_DELEGATIONS` as an explicit persona-UUID target map only alongside matching native `allowAgents`; default `{}` prohibits cross-persona registration.

Flight registration/confirmation/reconciliation use authenticated `/internal/flight-register`, `/internal/flight-confirm` and `/internal/flight-reconcile` envelopes. Set `FLIGHT_RESTORE_POLICY_ID` only to a registered, verified policy granted to the canonical Inbox routines. The daily restoration turn calls reconciliation rather than independently scanning and mutating mail; deadline jobs use `flight-restore:leg_id:revision` effect keys. A nonempty confirmed effect receipt is mandatory. Queued/uncertain older revisions block newer restoration work for that leg; cancellation or failure requires reconciliation, not blind replay.
