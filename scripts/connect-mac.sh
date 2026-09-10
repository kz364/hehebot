#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: scripts/connect-mac.sh wss://gateway.name.ts.net /private/path/token-file' >&2; exit 1; }
[[ "$1" == wss://*.ts.net || "$1" == wss://*.ts.net/ ]] || { echo 'Use the real private Tailscale HTTPS/WSS hostname.' >&2; exit 1; }
[[ -r "$2" ]] || { echo 'Token file not readable' >&2; exit 1; }
app="$HOME/Applications/OpenClaw.app/Contents/MacOS/openclaw-mac"
[[ -x "$app" ]] || app=/Applications/OpenClaw.app/Contents/MacOS/openclaw-mac
exec "$app" primary set --direct-url "$1" --token-file "$2" --json
