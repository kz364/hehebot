#!/usr/bin/env bash
set -euo pipefail

# Installs only the selected upstream CLI. This script never performs login or inference.
VERSION=0.154.0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/.local/codex-runtime"
NPM_BIN="${NPM:-npm}"

usage() {
  echo "Usage: scripts/setup-codex.sh [--runtime-dir ABSOLUTE_PATH] [--npm PATH]"
}
while (($#)); do
  case "$1" in
    --runtime-dir) RUNTIME_DIR="${2:?missing path}"; shift 2 ;;
    --npm) NPM_BIN="${2:?missing path}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$RUNTIME_DIR" = /* ]] || { echo "runtime directory must be absolute" >&2; exit 2; }

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
"$NPM_BIN" install --prefix "$RUNTIME_DIR" --no-save --no-package-lock --ignore-scripts \
  --include=optional --omit=dev "@openai/codex@$VERSION"

PACKAGE="$RUNTIME_DIR/node_modules/@openai/codex/package.json"
BINARY="$RUNTIME_DIR/node_modules/.bin/codex"
[[ -f "$PACKAGE" && -x "$BINARY" ]] || { echo "Codex installation incomplete" >&2; exit 1; }
INSTALLED="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version)' "$PACKAGE")"
[[ "$INSTALLED" = "$VERSION" ]] || { echo "Codex package version mismatch" >&2; exit 1; }
CLI_VERSION="$("$BINARY" --version)"
[[ "$CLI_VERSION" = "codex-cli $VERSION" ]] || { echo "Codex CLI version mismatch" >&2; exit 1; }
printf 'Codex %s installed at %s\n' "$VERSION" "$RUNTIME_DIR"
