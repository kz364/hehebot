# Future remote Gateway

Prepared 2026-09-10 against current official documentation; the local installation targets stable v2026.9.3. These are deployment instructions, not a record of deployment: no VM has been created or contacted. Documentation can describe changes newer than the stable release. Recheck the installed CLI help and effective state paths when deploying; use only commands supported by the installed version.

```text
Mac: app / CLI + paired node + local browser / computer
                         │ outbound WSS over private tailnet
                         ▼
VPS: Tailscale Serve → loopback OpenClaw Gateway
                         ├─ authoritative sessions, memory, automations
                         ├─ provider credentials and remote tools
                         └─ persistent managed headless browser
```

The Gateway remains available while the Mac sleeps. Mac tools require the node to be online; jobs that need them must wait or use an explicitly selected remote tool. There is no second agent state store to synchronize. See [official remote architecture](https://docs.openclaw.ai/gateway/remote).

## When you buy the VM — eight steps

1. **Choose a Linux VM and user.** Prefer supported Ubuntu LTS and a normal non-root service account, with SSH keys and local SSD storage. Keep a provider recovery console available. Copy this configuration repository to that account. No Docker or source checkout is required.
2. **Join the tailnet.** Install Tailscale using its [Linux instructions](https://tailscale.com/download/linux), run `sudo tailscale up`, and authenticate into the same tailnet as the Mac. Enable MagicDNS and HTTPS in the Tailscale admin console. Verify SSH over the tailnet before removing public SSH access. Restrict tailnet grants to your devices/account.
3. **Install the stable runtime.** Run `bash scripts/bootstrap-vm.sh`. It uses the official prefix installer, keeping the runtime in `~/.local/share/openclaw`; put `~/.local/share/openclaw/bin` on the service user's PATH. Confirm `openclaw --version`. Install a supported Chrome/Chromium browser for the VM architecture and verify its sandbox works as this user. See [installation](https://docs.openclaw.ai/install) and [Linux browser troubleshooting](https://docs.openclaw.ai/tools/browser-linux-troubleshooting).
4. **Install private configuration and credentials.** Use `config/remote-gateway.json` as the starting configuration; set a workspace override if desired and choose the model. Generate a fresh Gateway token, put it and provider credentials in `~/.config/openclaw/gateway.env` as configured by the bootstrap, and use owner-only permissions. Complete provider login on the VPS. Do not copy the Mac's whole home, existing Chrome profile, or Codex credentials automatically. Use the model's supported account/OAuth path when appropriate.
5. **Enable the official service.** Follow the service commands below. Keep `gateway.mode: "local"` on the VPS (it hosts the Gateway), `gateway.bind: "loopback"`, `gateway.tailscale.mode: "serve"`, and token authentication. Use `gateway.auth.allowTailscale: false` when requiring the shared token on every access path. Set the exact HTTPS UI origin in `gateway.controlUi.allowedOrigins` if required by the deployed version. Let OpenClaw own its Serve route.
6. **Connect the Mac and approve it.** Set the Mac app to Remote / Direct with `wss://<vps-magicdns-name>/` and the private Gateway credential; use SSH transport as fallback. Use the app's native worker/node; a separate headless node service is normally unnecessary. On the VPS inspect `openclaw devices list` and approve only its matching request with `openclaw devices approve <requestId>`. Also inspect `openclaw nodes pending` and approve the intended capability surface using `openclaw nodes approve <requestId>`; device pairing alone may leave capabilities empty. Confirm `openclaw nodes status`. See [pairing](https://docs.openclaw.ai/start/pairing) and [node capabilities](https://docs.openclaw.ai/platforms/linux).
7. **Verify both browser modes and persistence.** Test the Control UI, model response, remote managed browser, and explicit Mac-node browser/computer actions using the benign local test page. Keep the remote browser selected for routine autonomous work; select the Mac node deliberately for local signed-in work. Reboot the VPS, confirm service health, disconnect/reconnect the Mac, and verify the same remote session continues. Do not call deployment finished until these tests pass.
8. **Create and export a verified backup.** Follow the backup procedure below and retain an encrypted copy off the VM. Record the runtime version and test a staged restore before relying on unattended operation.

## Service, secrets, and network

Run these on the future VPS as its service account, after installing private config and secrets:

```bash
sudo loginctl enable-linger "$USER"
openclaw gateway install
systemctl --user enable --now openclaw-gateway.service
openclaw gateway status
systemctl --user cat openclaw-gateway.service
```

Use the upstream generated unit at `~/.config/systemd/user/openclaw-gateway.service`; it carries the correct runtime path and restart behavior. Do not maintain a parallel system service. Check that lingering is enabled with `loginctl show-user "$USER" -p Linger`. If a headless login lacks the user runtime environment, set `XDG_RUNTIME_DIR=/run/user/$(id -u)` before retrying. The [Gateway runbook](https://docs.openclaw.ai/gateway) documents this lifecycle.

The bootstrap links `~/.openclaw/.env` to `~/.config/openclaw/gateway.env` so CLI commands also resolve the token. It creates the following drop-in at `~/.config/systemd/user/openclaw-gateway.service.d/10-secrets.conf`:

```ini
[Service]
EnvironmentFile=%h/.config/openclaw/gateway.env
```

Keep the environment file at mode `0600` and its parent directory `0700`, then run `systemctl --user daemon-reload` and `openclaw gateway restart`. It is a systemd environment file, not a shell script: use `NAME=value` assignments, no `export` or command substitutions. Do not put secret values in the unit, Git, command-line arguments, screenshots, or logs. A login shell's exported variables are not automatically available to systemd. Configured file SecretRefs are an alternative that avoids this environment-file dependency. Review `systemctl --user cat` locally because generated units may include sensitive environment values.

Tailscale Serve keeps the public VM interface free of Gateway listeners. Never open Gateway port 18789, browser/CDP ports, or desktop-control ports in the cloud firewall. Allow necessary outbound traffic and only the ingress required for your selected Tailscale/SSH topology. Do not enable Funnel. Verify actual listening addresses with `ss -lntp` and inspect `tailscale serve status`; managed Serve uses an additional ephemeral loopback listener in current releases. If Serve needs local daemon permission, grant it to the selected service user through the supported Tailscale operator configuration rather than running OpenClaw as root. See [Tailscale topology and requirements](https://docs.openclaw.ai/gateway/tailscale).

## What must survive a machine replacement

`STATE` below means `OPENCLAW_STATE_DIR`, default `~/.openclaw`, on the authoritative VPS. Actual paths can be overridden; retain the backup manifest and active config as the final inventory.

| Data | Default path / source of truth |
|---|---|
| Main configuration | `$STATE/openclaw.json`, or `OPENCLAW_CONFIG_PATH`; include every referenced include file |
| Shared runtime, registrations, approvals, plugin state | `$STATE/state/openclaw.sqlite` |
| Active sessions, transcripts, memory indexes, per-agent auth/runtime | `$STATE/agents/<agentId>/agent/openclaw-agent.sqlite`; custom `agentDir` changes this root |
| Human-readable memory and workspace | `$STATE/workspace/MEMORY.md`, `$STATE/workspace/memory/`, plus the entire configured workspace and its bootstrap/skill files |
| Old session material | `$STATE/agents/<agentId>/sessions/` contains legacy/import/export/archive material; it is not the complete active history |
| Credentials | Shared/per-agent databases, `$STATE/credentials/`, and all external secret-provider files/references; optional file SecretRefs often use `$STATE/secrets.json` |
| Managed browser logins/profile | `$STATE/browser/<profile>/user-data/`; confirm the effective location with browser status and preserve the full browser directory |
| Mac signed-in Chrome state | Stays on the Mac, normally `~/Library/Application Support/Google/Chrome/`; outside Gateway backup and not portable by assumption |
| Plugins, skills, MCP | `plugins`, `skills`, and `mcp` configuration in active config/includes; installed extensions under `$STATE/extensions/`; managed skills under `$STATE/skills/`; workspace skills under its `skills/`; OAuth/plugin runtime state also lives in shared SQLite |
| Service configuration | User service and drop-ins under `~/.config/systemd/user/`, plus any referenced environment files |

Current [database layout](https://docs.openclaw.ai/reference/database-schemas/layout), [workspace layout](https://docs.openclaw.ai/concepts/agent-workspace), [credential locations](https://docs.openclaw.ai/gateway/security/secrets-and-storage), and [browser profile location](https://docs.openclaw.ai/tools/browser-linux-troubleshooting). Older guides listing only JSONL sessions or `auth-profiles.json` are insufficient for current releases. SecretRef payloads and browser cookies remain sensitive even when tracked configuration contains no literal secrets.

## Backup and recovery

```bash
openclaw backup create --dry-run --json
mkdir -p "$HOME/Backups"
openclaw backup create --output "$HOME/Backups/openclaw-backup.tar.gz" --verify
openclaw backup verify /path/to/archive.tar.gz
openclaw backup restore /path/to/archive.tar.gz --target "$HOME/openclaw-restored"
```

Use the same profile, config path, and state environment as the Gateway. Inspect dry-run coverage: external includes, secrets, and arbitrary external plugin/MCP state may need separate backup. Stop managed browser processes before backing up their profile. OpenClaw safely snapshots its SQLite databases; never raw-copy live `.sqlite`, WAL, or SHM files. Backup archives are sensitive and not inherently encrypted. Encrypt before offsite storage and keep the decryption key separately. See [backup CLI](https://docs.openclaw.ai/cli/backup).

Restore targets must be empty/new. Inspect the verified `manifest.json` source-to-archive mapping, stop the Gateway and any processes touching its state, preserve current state, then activate the mapped state/config/workspace/agent assets. Adjust machine paths and restore external credentials. Run `openclaw doctor`, restart, and check health, sessions, and browser logins. Reinstall omitted plugin dependencies with `openclaw plugins update <id>` or the original install specification. Rollback may require channel relinking; test it before an emergency. See [restore details](https://docs.openclaw.ai/install/backups).

## Updates and migration from this Mac

```bash
mkdir -p "$HOME/Backups"
openclaw backup create --output "$HOME/Backups/openclaw-backup.tar.gz" --verify
openclaw update --channel stable
openclaw health
openclaw doctor
```

The supported updater normally refreshes, restarts, and verifies the managed service. No extra restart is required after a successful managed update. After manual package replacement use `openclaw gateway restart`. Update the Mac app/CLI separately; recheck node and browser capabilities after updates. Keep customization outside installed packages. See [updates](https://docs.openclaw.ai/install/updating) and [release channels](https://docs.openclaw.ai/install/development-channels).

This setup's local test Gateway is disposable. Start the real remote workspace clean, copying only reviewed user/agent configuration and desired human-readable workspace material. Do not promote test sessions, test tokens, or browser test cookies into production. If meaningful local agent history later exists, stop that local Gateway, create a verified archive, restore it offline on the VPS using the manifest, adjust paths, run Doctor, and start only the VPS Gateway. Then configure the Mac exclusively as remote client/node and disable any leftover local Gateway service. See [official migration](https://docs.openclaw.ai/install/migrating). No continuous state synchronization is needed.
