# OpenClaw setup

## Current shared-Sprite setup

The selected target is one Fly Sprite, Cloudflare portal/API/scheduler and an optional paired Mac. Start with [AUTH_SETUP.md](docs/AUTH_SETUP.md), [NATIVE_AUTH_SETUP.md](docs/NATIVE_AUTH_SETUP.md), [BOT_SETUP.md](docs/BOT_SETUP.md) and [IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md). The local portal now reviews/adopts five bots and seven disabled routines. No native/connector login transfers from the historical Grok setup. Live execution remains disabled pending the native O01–O09 and provider activity gates. The inventory below is historical local evidence, not proof of a deployed Sprite.

## Earlier remote-first contract
One future authoritative VPS Gateway; Mac is an intermittent client/node. No VM provisioning, cloud connection, Docker, core fork, or agent synchronization.

## 2026-09-10 inventory and changes
- Empty project directory initialized as its own Git repository (parent home repository left untouched).
- Existing `~/.local/bin/openclaw` is a wrapper into a Dropbox source checkout, version 2026.3.3. Existing `~/.openclaw` contains agent state and a local Gateway configuration; preserve it.
- Latest official GitHub stable release observed: 2026.9.3.
- Installing via official `install-cli.sh` into `~/.local/share/openclaw`, with a private supported Node runtime and no onboarding. This avoids altering the system Node or source checkout.
- Local functionality will be exercised with isolated disposable state, no model credentials or real-account actions.

## Progress
Local installation and available capability tests are complete; permission/authentication-dependent tests remain listed below. See docs/REMOTE.md for future deployment guidance.

### User-authorized clean replacement
The user subsequently authorized completely wiping the old installation. Removal targets: `~/.openclaw`, `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, `~/.local/bin/openclaw`, and the exact old source checkout `~/Dropbox (Personal)/Vibes/openclaw`. No historical agent state will be migrated. New runtime remains separate at `~/.local/share/openclaw`.

## Completed and verified

- Installed upstream stable CLI 2026.9.3 (1391f7c), private Node 24.19.0, and signed Mac app 2026.9.3 (2609000390). The default CLI symlink resolves to the new prefix installation.
- Verified macOS code signature and Gatekeeper assessment; no quarantine bypass.
- Removed the exact old state/service/wrapper/source checkout after explicit user authorization.
- Created remote-only Mac config and validated both machine templates against the stable schema. No core modifications, Docker, custom MCP, or separate node service.
- Temporary token-authenticated Gateway on loopback 19789 started successfully; health reported no plugin errors. Native app connected as remote operator and node.
- Browser navigation, multi-field fill (name/email/date), dropdown, checkbox, step navigation, dynamic typing, upload, local submission, screenshot and download all passed. Download contents matched the fixture. Screenshot was visually inspected.
- Authenticated Control UI rendered the chat composer and navigation. No model was configured, so model responses/autonomous decision-making were not tested.
- Node advertised browser/system/files/computer capabilities. `system.which` returned `/bin/sh` and `/usr/bin/python3`; `fs.listDir` responded but contained no entries for the files-only fixture directory. File-content execution/transfer remains unverified.
- Stopped/restarted the same Gateway. Mac reconnected automatically after backoff, using its existing node identity. Browser restarted with the same managed profile.
- Official backup creation with verification and a fresh staged restore both passed on disposable state. Actual SQLite agent paths agree with the documented inventory.
- Shell scripts pass `bash -n`.

## Remaining actions / blocked tests

| Area | Status |
|---|---|
| Stable CLI, signed app, remote-only Mac config | Completed |
| Gateway start, authenticated web UI, native operator/node connection | Locally tested |
| Managed browser forms, upload/download, screenshot | Locally tested |
| Gateway restart and Mac automatic reconnect | Locally tested |
| Backup verify and staged restore | Locally tested on disposable state |
| Remote config/bootstrap/service drop-in/security/update/recovery | Prepared, awaiting VM; Linux execution not tested |
| Tailscale installation and account sign-in | Instructions prepared; not installed/authenticated in this run |
| Signed-in Chrome control | Profile prepared; extension setup blocked pending explicit user approval |
| Native computer control | Advertised, but Accessibility/Screen Recording off; screenshot failed |
| Shell command execution and file-content access/transfer | Not verified; normal agent exec requires model setup, and broader direct test policy was rejected |
| Remote persistent browser, VPS reboot, model inference | Await VM and model authentication |

Automatic approval review rejected (1) the Chrome native-helper/Store-extension setup pending user approval, and (2) broadening the disposable Gateway tool profile for direct exec testing. Neither rejected change was applied. The earlier temporary HTTP exec allow entry returned Tool not available and was removed; default HTTP tool restrictions remain in place.

## Final running state and evidence

Test browser, Gateway and fixture server were stopped. No listeners remained on 19789, 19800 or 19880; no OpenClaw Gateway/node LaunchAgent was loaded. The Mac template has `gateway.mode=remote` with no invented VPS endpoint. Test app connections are cleared, including its automatically saved loopback Gateway entry. Idle-sleep guards ended with test processes.

Private local evidence is under ignored `.local/`: health/node JSON, browser screenshot, backup archive, staged restore, and logs. Do not migrate these to the VPS. The fixture upload/download files are under `/tmp/openclaw/uploads/openclaw-test-upload.txt` and `/tmp/openclaw/downloads/openclaw-test-download.txt`. No real online account submissions or paid inference calls occurred.

## Undo / future maintenance

The old state/source deletion was explicitly requested and is not reversible through these Git commits. To remove the new setup, stop/quit the Mac app, remove `~/Applications/OpenClaw.app`, remove the `~/.local/bin/openclaw` symlink and `~/.local/share/openclaw` runtime, and remove newly created `~/.openclaw`/test app state only if no later work needs it. Keep this repository for the templates or remove it independently. No system Node installation was changed. Git commits reverse repository customization only, not installation or state mutations.

Update the CLI with `scripts/update-mac.sh`; update the signed app through its own updater. For the remote Gateway follow docs/REMOTE.md. Configuration, credentials and runtime state stay outside installed package files.
