#!/usr/bin/env bash
# Installs the pinned browser stack used by runtime/browser-gateway.mjs:
# Playwright MCP (exact version) and its matching Chromium headless shell.
# Idempotent and non-interactive. System libraries need passwordless sudo
# (present on Sprites); set HEHEBOT_BROWSER_SKIP_DEPS=1 where they are managed
# elsewhere. Point the runtime config's browser.dir at the install directory.
set -euo pipefail

PLAYWRIGHT_MCP_VERSION=0.0.82
DIR="${HEHEBOT_BROWSER_DIR:-$HOME/.hehebot/browser}"
MARKER="$DIR/installed.json"

if [ -f "$MARKER" ] && grep -q "\"playwright_mcp\": \"$PLAYWRIGHT_MCP_VERSION\"" "$MARKER" \
   && [ -d "$DIR/browsers" ] && [ -f "$DIR/node_modules/@playwright/mcp/cli.js" ]; then
  echo "browser stack already installed ($PLAYWRIGHT_MCP_VERSION) at $DIR"
  exit 0
fi

mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR"
[ -f package.json ] || printf '{"name":"hehebot-browser","private":true}\n' > package.json
npm install --no-audit --no-fund --save-exact "@playwright/mcp@$PLAYWRIGHT_MCP_VERSION" >/dev/null

deps=--with-deps
if [ "${HEHEBOT_BROWSER_SKIP_DEPS:-}" = 1 ]; then deps=; fi
PLAYWRIGHT_BROWSERS_PATH="$DIR/browsers" npx --no-install playwright install $deps --only-shell chromium >/dev/null

playwright_version="$(node -e 'console.log(require("playwright-core/package.json").version)')"
printf '{"playwright_mcp": "%s", "playwright": "%s", "installed_at": "%s"}\n' \
  "$PLAYWRIGHT_MCP_VERSION" "$playwright_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
echo "browser stack installed at $DIR (playwright-mcp $PLAYWRIGHT_MCP_VERSION, playwright $playwright_version)"
