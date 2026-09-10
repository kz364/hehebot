#!/usr/bin/env bash
set -euo pipefail
# Re-run the official installer: private Node + package, no default Gateway startup.
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh -o "$installer"
caffeinate -i bash "$installer" --prefix "$HOME/.local/share/openclaw" --version latest --no-onboard
"$HOME/.local/share/openclaw/bin/openclaw" --version
printf '%s\n' 'Update the signed Mac app through its update UI, then reconnect. No core patches to reapply.'
