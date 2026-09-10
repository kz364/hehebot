#!/usr/bin/env bash
# Execute ON the future VM, never from the Mac. No provisioning or SSH here.
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'Run this on the future Linux VM.' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as the non-root service account.' >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
umask 077
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh -o "$installer"
bash "$installer" --prefix "$HOME/.local/share/openclaw" --version latest --no-onboard
mkdir -p "$HOME/.openclaw" "$HOME/.config/openclaw" "$HOME/.config/systemd/user/openclaw-gateway.service.d"
if [[ ! -f "$HOME/.config/openclaw/gateway.env" ]]; then
  printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$HOME/.config/openclaw/gateway.env"
fi
if [[ ! -f "$HOME/.openclaw/openclaw.json" ]]; then
  cp "$root/config/remote-gateway.json" "$HOME/.openclaw/openclaw.json"
fi
# OpenClaw loads its state-root .env for both CLI and service invocations.
if [[ ! -e "$HOME/.openclaw/.env" && ! -L "$HOME/.openclaw/.env" ]]; then
  ln -s "$HOME/.config/openclaw/gateway.env" "$HOME/.openclaw/.env"
fi
cat > "$HOME/.config/systemd/user/openclaw-gateway.service.d/10-secrets.conf" <<'UNIT'
[Service]
EnvironmentFile=%h/.config/openclaw/gateway.env
Restart=always
RestartSec=5
UNIT
"$HOME/.local/share/openclaw/bin/openclaw" config validate
printf '%s\n' 'Runtime and private config prepared. Continue docs/REMOTE.md: Tailscale, browser, model login, then official gateway install. Service not started by this script.'
