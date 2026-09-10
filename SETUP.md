# OpenClaw remote-first setup

## Contract
One future authoritative VPS Gateway; Mac is an intermittent client/node. No VM provisioning, cloud connection, Docker, core fork, or agent synchronization.

## 2026-09-10 inventory and changes
- Empty project directory initialized as its own Git repository (parent home repository left untouched).
- Existing `~/.local/bin/openclaw` is a wrapper into a Dropbox source checkout, version 2026.3.3. Existing `~/.openclaw` contains agent state and a local Gateway configuration; preserve it.
- Latest official GitHub stable release observed: 2026.9.3.
- Installing via official `install-cli.sh` into `~/.local/share/openclaw`, with a private supported Node runtime and no onboarding. This avoids altering the system Node or source checkout.
- Local functionality will be exercised with isolated disposable state, no model credentials or real-account actions.

## Progress
Installation and capability verification in progress. See docs/REMOTE.md for future deployment guidance.

### User-authorized clean replacement
The user subsequently authorized completely wiping the old installation. Removal targets: `~/.openclaw`, `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, `~/.local/bin/openclaw`, and the exact old source checkout `~/Dropbox (Personal)/Vibes/openclaw`. No historical agent state will be migrated. New runtime remains separate at `~/.local/share/openclaw`.
