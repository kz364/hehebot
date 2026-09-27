#!/bin/bash
# Renders the Hehebot Mac node LaunchAgent. It does NOT load it and does NOT
# request any macOS permission: grant Full Disk Access yourself (docs/MAC_NODE.md).
#   bash mac-node/install-launchd.sh [--prefix DIR]
# --prefix renders into DIR instead of $HOME (used by tests).
set -euo pipefail
PREFIX="$HOME"
if [[ ${1:-} == --prefix ]]; then PREFIX=$2; fi
ROOT=$(cd "$(dirname "$0")" && pwd)
SUPPORT="$PREFIX/Library/Application Support/Hehebot Node"
AGENTS="$PREFIX/Library/LaunchAgents"
LOGS="$PREFIX/Library/Logs"
mkdir -p "$SUPPORT/bin" "$AGENTS" "$LOGS"
chmod 700 "$SUPPORT"
# A dedicated copy of node, so Full Disk Access is granted to this binary only
# and not to every node process on the Mac.
NODE_SRC=$(command -v node)
cp "$NODE_SRC" "$SUPPORT/bin/node"
chmod 755 "$SUPPORT/bin/node"
PLIST="$AGENTS/com.hehebot.mac-node.plist"
escape() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
sed -e "s|@NODE@|$(escape "$SUPPORT/bin/node")|" \
    -e "s|@SCRIPT@|$(escape "$ROOT/mac-node.mjs")|" \
    -e "s|@CONFIG@|$(escape "$SUPPORT/config.json")|" \
    -e "s|@LOG@|$(escape "$LOGS/hehebot-mac-node.log")|" \
    "$ROOT/launchd/com.hehebot.mac-node.plist.template" > "$PLIST"
if command -v plutil >/dev/null; then plutil -lint "$PLIST" >/dev/null; fi
cat <<EOF
Rendered $PLIST
Next (see docs/MAC_NODE.md):
  1. Pair:   "$SUPPORT/bin/node" "$ROOT/mac-node.mjs" pair --origin https://YOUR-PORTAL --code CODE \\
               --access-id-file FILE --access-secret-file FILE
  2. System Settings > Privacy & Security > Full Disk Access: add "$SUPPORT/bin/node"
  3. Check:  "$SUPPORT/bin/node" "$ROOT/mac-node.mjs" check
  4. Start:  launchctl bootstrap gui/\$(id -u) "$PLIST"
     Stop:   launchctl bootout gui/\$(id -u)/com.hehebot.mac-node
EOF
