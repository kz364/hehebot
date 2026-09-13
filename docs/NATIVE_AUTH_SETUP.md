# Native account authentication and optional device setup

Checked 2026-09-10 against installed OpenClaw **2026.9.3** documentation and current official pages. This is a setup checklist, not a record of completed sign-ins. Sprites and Cloudflare account/provisioning steps belong in the deployment checklist. Run the commands below **inside the selected Sprite**, as the same user and with the same persistent OpenClaw state/config/workspace environment as its Gateway service. Signing in on the Mac does not authenticate that Sprite.

The existing isolated proof established Gateway token authentication and a read-only health RPC. It did **not** establish OpenAI OAuth, model execution, laptop pairing to Sprites, WhatsApp linkage, refresh or catch-up. See [runtime compatibility](RUNTIME_COMPATIBILITY.md).

## Who supplies what

| Item | Owner action | Implementation action |
| --- | --- | --- |
| ChatGPT/Codex subscription | Choose the account/workspace, complete OpenAI browser login and MFA/device consent | Start OpenClaw's supported flow; validate selected OAuth profile and runtime without copying credentials |
| Gateway token | No new external account required | Generate a unique secret, persist it privately, and provide it only to the Gateway/local executor and any explicitly authorized device |
| Control-plane runtime credential | No interactive sign-in | Generate a separate credential; store according to Cloudflare/Sprite deployment configuration; never reuse the Gateway token |
| Laptop node (optional) | Connect the signed Mac app, approve the identified device and desired capabilities, grant macOS permissions | Inspect pending identity and capability requests; verify connectivity and synthetic actions |
| WhatsApp (optional) | Select the intended phone account and scan its linked-device QR | Start QR login in the Sprite's persistent state; verify channel status; keep automatic inbound routing disabled during setup |
| Other accounts/connectors (optional) | Select the service/account and approve its requested scopes/MFA | Install and configure the selected supported integration; record scope and run a bounded read-only check |

Secret values, QR images and device codes must not be pasted into repository files, prompts, routine instructions or public portal state. Implementation-generated service secrets are independent of personal OAuth consent.

## 1. Sign the Sprite into OpenAI using the subscription

**Owner:** use the intended ChatGPT account/workspace. For headless device-code login, OpenAI documents enabling device-code authentication in personal security settings or through the workspace administrator. Complete the displayed link/code flow yourself. The direct Codex CLI uses different command spelling; this project uses OpenClaw's flow and its own credential store. Do not copy desktop `~/.codex` state. [Official OpenAI authentication](https://learn.chatgpt.com/docs/auth)

**Implementation:** confirm the pinned version and actual agent IDs first:

```bash
openclaw --version
openclaw agents list
openclaw models auth login --help
```

For each configured agent that needs an OAuth profile, substitute its real ID for `AGENT_ID` and run:

```bash
openclaw models auth login --provider openai --device-code --agent AGENT_ID
```

If an eligible shared profile is already visible to the agent, select it through supported auth ordering instead of duplicating the login. Do not start repeated concurrent OAuth flows. Browser-based alternative, when its callback can be reached securely:

```bash
openclaw models auth login --provider openai --agent AGENT_ID
```

Choose a subscription model actually listed for that account. List the account's available models, then set only the model you deliberately select:

```bash
openclaw models list --provider openai --agent AGENT_ID
openclaw config set agents.defaults.model.primary OPENAI_MODEL_ID
```

This command changes the installation default; do not overwrite an intentionally selected per-agent model. An absent account/model is a setup blocker, not a reason to add a paid key. [OpenClaw OpenAI setup](https://docs.openclaw.ai/providers/openai/setup)

## 2. Prove the selected route and prohibit paid fallback

Run these status/config commands, which do not intentionally invoke a model; output can include account metadata and belongs in a private setup session:

```bash
openclaw models status --agent AGENT_ID
openclaw models auth list --agent AGENT_ID --provider openai
openclaw models auth order get --agent AGENT_ID --provider openai
openclaw config get agents.defaults.model --json
openclaw config get models.providers.openai.agentRuntime --json
openclaw config validate
```

Use the exact OAuth profile ID returned by the list command, not a guessed email/profile name:

```bash
openclaw models auth order set --agent AGENT_ID --provider openai PROFILE_ID
```

This creates the supported per-agent order override. Verify profile type is OAuth and the intended account. Check each persona's effective model and profile; a default-agent success does not establish every persona's routing. `models status --probe` is **not** a passive status command: it can make model calls and requires exclusive state ownership. Do not run it against an active Gateway. [Models CLI](https://docs.openclaw.ai/cli/models)

The `openai/*` prefix supports both subscription and API-key accounts. For the native Codex path, confirm `/codex status` and `/codex models` in an authenticated native OpenClaw test chat. These are native commands; the custom messaging portal does not yet promise to intercept them.

Ensure the Sprite service environment and loaded secret/config sources have neither `OPENAI_API_KEY` nor `CODEX_API_KEY`, no API-key profile in the selected auth order, and no paid provider/model fallback. Check presence/type through supported configuration tooling without dumping secret values. The native harness can use those environment variables when no account is present. Native runtime selection also depends on effective route/runtime configuration; the prefix alone proves neither runtime nor billing. Keep auth-failure handling at `AUTH_REQUIRED`/quota-blocked. [Native Codex authentication and routing](https://docs.openclaw.ai/providers/openai/runtimes)

**Final live acceptance, still pending:** with the chosen OAuth profile verified, perform one synthetic read-only subscription-backed turn with no connectors, stop/restart through the Sprite runtime supervisor, then perform a second turn. Record model, runtime, auth type and result, never tokens. Two successes prove restart continuity; they do not prove future refresh. Verify refresh separately when it occurs, and keep automatic production execution disabled until the other runtime gates pass.

## 3. Preserve OpenClaw's own auth state

Installed 2026.9.3 documentation identifies the default stores below. `OPENCLAW_STATE_DIR` and other configured path overrides change their actual locations:

- Shared credentials: `~/.openclaw/state/openclaw.sqlite`.
- Per-agent overrides/routing: `~/.openclaw/agents/AGENT_ID/agent/openclaw-agent.sqlite`.
- Agent credential/routing tables: `auth_profile_store` and `auth_profile_state`.

These are identification/backup boundaries, **not instructions to inspect or edit database secrets directly**. Persist the complete managed state consistently across Sprite cold starts. A per-agent `codex-home/auth.json` is not the prescribed auth store; do not populate it from the desktop. Refresh must have one writable owner. Older JSON auth files and modern identity-scoped personal accounts have different migration/ownership paths, so use the pinned CLI rather than file copying. [OpenClaw OAuth storage](https://docs.openclaw.ai/concepts/oauth)

## 4. Optional laptop pairing and permissions

This is only needed for tasks that use the Mac's local browser, files or computer. The portal and Sprite work should remain usable while the laptop sleeps.

**Owner:** connect the signed OpenClaw Mac app to the chosen Gateway through a supported private WSS or SSH path. Sprites API authentication and Cloudflare portal login are separate from native Gateway pairing. A public Sprite URL is not automatically an authenticated Mac-node ingress; deployment must first establish a compatible path. Keep native Gateway loopback-bound until that path is ready. The app supplies its node/worker; a separate headless Mac node service is normally unnecessary. [Mac remote connection](https://docs.openclaw.ai/platforms/mac/remote)

**Implementation/owner on the Gateway:** review the exact pending request, matching the intended Mac, before approval:

```bash
openclaw devices list
openclaw devices approve REQUEST_ID
openclaw nodes pending
openclaw nodes approve REQUEST_ID
openclaw nodes status
openclaw nodes describe --node NODE_ID
```

Device approval allows the connection; node capability approval authorizes its exposed command surface. They are distinct. Do not approve unrelated requests or add broad capabilities to resolve an identity mismatch. Confirm node ID, online state, permissions and approved commands; test offline behavior separately. [Nodes CLI and capability approval](https://docs.openclaw.ai/cli/nodes)

**Owner on the Mac:** open **Dashboard → Settings → This Mac → Permissions**. For computer control, grant the signed app the requested Accessibility/Event Posting and Screen Recording permissions; screenshot access alone does not prove clicks/typing. Enable Computer Control only when needed. Keep camera, microphone, location, cookie sync and active-computer presence off unless a chosen feature needs them. File access can require its own macOS grant. Preserve the app's installation path/signature, and reopen the app if a permission change requires it. Avoid granting Accessibility to a generic shared Node binary. [macOS permissions](https://docs.openclaw.ai/platforms/mac/permissions)

## 5. Shared WhatsApp linkage and exact family-chat selection

Keep native inbound agent routing blocked during account setup (`channels.whatsapp.dmPolicy: "disabled"`, `groupPolicy: "disabled"`, including any account overrides). This prevents linking an account from silently enabling a second inference path outside the portal/control plane. It does not prove offline catch-up or read-only history access.

Run inside the persistent Sprite environment:

```bash
openclaw channels login --channel whatsapp
openclaw channels status --probe
```

For a named account, add `--account ACCOUNT_ID` to login. **Owner:** use WhatsApp on the intended phone account → Linked devices → Link a device, and scan the live QR. QR login is separate from sender access approval. If WhatsApp input is intentionally enabled later, use an owner-specific allowlist or reviewed pairing; CLI sender review is `openclaw pairing list whatsapp` / `openclaw pairing approve whatsapp CODE`.

Select the family chat once after pairing: match the intended phone account and exact native chat/JID against the owner's chosen conversation and participants. Store that account ID + chat ID in private shared connector configuration; the display name alone is not a selector, and no exact family-chat ID has been verified yet. Every routine read must enforce that ID even though the linked session can access other chats. Link once for the installation; personas share a scoped reference, never separate QR sessions. Verify a bounded family-chat fixture and deny a different chat before enabling the routine. Keep sending/read-receipt behavior outside this read-to-calendar workflow. Native linkage alone does not yet prove an on-demand history reader while inbound inference is disabled; that is an integration gate.

Default session material is under `~/.openclaw/credentials/whatsapp/ACCOUNT_ID/`, including `creds.json`; preserve it privately. Reconnect and measure known-message catch-up after a sleep/restart before relying on it. WhatsApp cannot be the guaranteed wake channel for a stopped Sprite; the messaging portal remains that channel. [WhatsApp setup, policies and persistence](https://docs.openclaw.ai/channels/whatsapp)

## 6. Other connectors

Existing ChatGPT/Codex connector authorization does not establish authorization for the deployed OpenClaw runtime. Select each intended integration (for example mail, calendar or a website session), then follow that integration's supported native login and scope controls. Record account, scopes, storage location, refresh owner and a synthetic read-only verification result. Add send/write scope only when a chosen workflow needs it; outbound messages still require task authorization. Browser sessions belong to the managed Sprite browser or an explicitly selected Mac node; no automatic desktop cookie/profile copying.

No optional connector is required merely to sign in to OpenAI or use the portal. Exact connector setup remains untested until the integration is selected.


## 7. Shared Google connection for imported routines

The selected architecture has **one installation-owned Google connection** shared through scoped tools: Gmail reading and mailbox-label changes for Inbox Triage, and Calendar event reads/writes for Inbox Triage, Whatsapp, Messages and Travel. Chief of Staff consumes task results. Existing desktop/ChatGPT grants are not transferred. The actual Google account email, OAuth client, grant and target calendar IDs have **not** been selected or verified; do not substitute a guessed `primary` calendar or infer ownership from a display name.

The required grant is:

| OAuth scope | Reason and limit |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.modify` | Read mail and apply/remove message labels for hold/restore. This scope also permits sending at Google's API layer. |
| `https://www.googleapis.com/auth/calendar.events` | Read/create/update the approved calendar events; the token covers accessible calendars, so enforce exact calendar IDs in tools. |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Discover exact calendar IDs and access roles for owner selection. |

Do not add `gmail.send`, Gmail settings/sharing, full `mail.google.com`, full `calendar`, Drive, Contacts or other unrelated scopes. **Omitting `gmail.send` does not make `gmail.modify` a no-send credential.** The required no-send behavior must deny send/draft-send and other unapproved methods at a trusted tool boundary; raw tokens and unrestricted authenticated CLI/shell access cannot be available to a model that this boundary is intended to constrain. Google has no read-plus-message-label-modification scope that excludes sending. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)

### Native integration availability and current scope blocker

The pinned OpenClaw installation includes a `gog` skill that invokes the external Google Workspace CLI. The bundled `google` plugin is a model-provider plugin, not Gmail/Calendar OAuth. Local **gog v0.11.0 (91c4c15)** is present; this says nothing about Sprite installation or account consent. Read-only `gog auth services --json` shows that this version's Gmail preset requests `gmail.modify`, `gmail.settings.basic`, `gmail.settings.sharing`; its Calendar preset requests full `calendar`. `gog auth add --help` has no exact-scope override. Consequently, **do not run the default `gog auth add ... --services gmail,calendar` for this setup**. The supported narrow-grant path remains blocked until a selected CLI/integration version is verified to request precisely the required grant. Current online gog flags differ from the local pin; copying a newer command without checking the installed version is not verification. No installation, upgrade or OAuth request was made here.

If gog is selected after this blocker is resolved, its documented user OAuth route needs a Google Cloud OAuth client configuration (normally Desktop app), with Gmail and Calendar APIs enabled and the intended user eligible for the consent screen. This is an OAuth client setup requirement for gog, not a generic Gmail API key, service account or domain-wide delegation requirement. Store client configuration and the managed refresh token privately in the Sprite's persistent gog state; do not clone desktop caches or create one per persona. The locally supported client-import spelling is `gog auth credentials set /PRIVATE/PATH/client_secret.json`; this is a later setup command, not executed. Inspect the eventual authorization URL/consent scopes without exposing its codes, and verify token grant metadata after consent. [gog OAuth clients](https://gogcli.sh/auth-clients.html), [gog quickstart](https://gogcli.sh/quickstart.html)

### Account/calendar mapping and bounded verification

Record in private installation configuration one `sharedGoogle` connection reference, authenticated account identity, client identity, managed refresh owner and actual granted scopes. For every routine record its exact calendar ID, title for display, access role and timezone. Select the owner-approved calendar by both identity and ID; school event interpretation remains `Asia/Jakarta`, independently of the proposed monitoring zone `Asia/Singapore`. No personal IDs belong in this shareable guide.

After the narrow consent path is established, a bounded calendar listing can use the version-checked command `gog calendar calendars --account EXACT_EMAIL --json`; it has not been run. Verify the chosen calendar's write role, read a bounded synthetic fixture, and prove that a wrong account/calendar is rejected by the tool boundary. A later authorized smoke test may create, read back, update and remove one clearly named test event in the selected calendar, without attendees, invitations or notification delivery. Gmail verification should read an approved fixture and round-trip only the intended temporary label, confirming unrelated labels are preserved. Do not send an email as a scope test. Record effect IDs and cleanup results privately. Refresh, restart continuity, no-send enforcement and cross-persona shared connection access all remain live gates.

## 8. Mac Messages reader and offline coverage

For the imported SMS/iMessage-to-calendar routine, Mac access is required even though other personas can operate while it sleeps. **Paired node availability alone does not provide a Messages reader.** Pinned OpenClaw 2026.9.3 documents the official external `@openclaw/imessage` channel plugin and `imsg` JSON-RPC reader. `imsg` was not found on the current Mac's PATH during this check; no reader, plugin deployment, Messages identity or OS permission was verified. The documented setup commands, to run only on the specified hosts during setup, are:

```bash
# Gateway host (Sprite): official native plugin, then managed Gateway restart
openclaw plugins install @openclaw/imessage
# Signed-in Messages Mac: basic reader
brew install steipete/tap/imsg
imsg --version
imsg rpc --help
```

The exact plugin version must be resolved and recorded for compatibility with the pinned Gateway before deployment. Use basic history/watch mode for this read-only routine. Do not run `imsg launch`, disable SIP/library validation, or grant Messages Automation for convenience; those are unnecessary advanced/send capabilities for the selected task. Full Disk Access is required for the **actual process context** reading the Mac's Messages database. Grant it through System Settings → Privacy & Security → Full Disk Access after identifying the executable/service user that will run the reader. A prior Grok, Terminal or desktop application grant does not prove a LaunchAgent, SSH wrapper or new process has access. Keep message sending, read receipts, typing, attachments and native automatic inbound model dispatch disabled for this polling integration. [Native iMessage requirements and modes](https://docs.openclaw.ai/channels/imessage)

For a Linux Sprite Gateway, the documented native transport is `channels.imessage.cliPath` pointing to a transparent SSH wrapper on the Sprite that executes `imsg` on the signed-in Mac. Establish a private reachable host, narrowly authorized SSH identity, known host key and exact absolute Mac executable/database paths first. The documented wrapper shape is `exec ssh -T messages-mac imsg "$@"`; replace the alias and binary with verified deployment values. Preserve immediate stdin/stdout forwarding and separate stderr. Do not treat the Cloudflare portal token or Mac node pairing as SSH credentials. Node-mediated reader invocation would need its own supported transport proof; it has not been established here.

After host permission is granted, run `imsg chats --limit 1 --json` in the **same execution context** that will run the deployed reader, using an owner-approved fixture and retaining output privately. Verify the correct signed-in Messages user, expected chat identity, supported history fields and stable message GUIDs. No private database or message was read in this inspection. A native channel probe can verify reachability later, but does not establish complete historical coverage.

Before first adoption, record the owner's intended history baseline and a durable Messages watermark; never use routine enablement time to imply all prior mail/messages were scanned. Native documented remote SSH recovery uses a live age fence, while the local Gateway mode has bounded row/age replay. These channel mechanisms do **not** prove arbitrary offline/overnight catch-up for a Sprite plus sleeping Mac. The polling routine must prove bounded history pagination from its persisted watermark, GUID dedupe, handling edits/deletes, and advance its watermark only after attributed durable results/effects. If the selected reader cannot cover the gap, retain the watermark, show `WAITING_FOR_DEVICE` or an explicit coverage gap, and reconcile after the Mac returns. Test a known fixture across Mac sleep/disconnection, Sprite restart and duplicate replay; verify exactly one calendar effect and preservation of the source. None of these live checks has passed yet.
