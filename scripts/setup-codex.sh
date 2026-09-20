#!/usr/bin/env bash
set -euo pipefail

# Installs only the selected upstream CLI. This script never performs login or inference.
# This is not a claim of safe active-runtime upgrades: an already-running process keeps its old
# files open regardless of replacement order.
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

# Failure-safe installation for an existing installation:
#   1. npm installs the exact candidate into a private staging directory inside the runtime
#      directory; a failed or partially destructive npm can only damage scratch state.
#   2. The staged candidate is fully validated (package present, executable, exact package and
#      CLI versions) before any installed file is touched. A failed npm or a mismatched
#      candidate therefore leaves the prior executable usable and unrelated runtime, config and
#      auth files byte-for-byte unchanged.
#   3. Only then is node_modules replaced by two renames, with rollback to the prior
#      installation on any replacement or re-validation failure.
# Documented limits, not transactional claims:
#   - The two renames are not one atomic transaction. A crash or power loss between them leaves
#     node_modules absent with the prior installation parked at .node_modules.previous; the
#     next run restores it before installing. A crash after the second rename leaves the
#     staging-validated new installation plus a stale parked copy, which the next run discards.
#   - No explicit fsync is performed; power-loss durability of the renames is not guaranteed.
#   - Concurrent installs into the same runtime directory are unsupported: a new run discards
#     stale staging state, which would break a concurrently running install.
#   - Handled failures roll back; an unhandled kill can leave private scratch state (.setup-staging)
#     that the next run removes.
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
MODULES="$RUNTIME_DIR/node_modules"
STAGING="$RUNTIME_DIR/.setup-staging"
PREVIOUS="$RUNTIME_DIR/.node_modules.previous"

# Crash/power-loss recovery from an interrupted replacement, best effort.
if [[ -e "$PREVIOUS" ]]; then
  if [[ -e "$MODULES" ]]; then
    # The staged, pre-validated candidate had already been swapped in; drop the parked prior copy.
    rm -rf "$PREVIOUS"
  else
    # The swap was interrupted between the two renames; restore the prior installation.
    mv "$PREVIOUS" "$MODULES"
  fi
fi
rm -rf "$STAGING"
mkdir "$STAGING"
trap 'rm -rf "$STAGING"' EXIT

"$NPM_BIN" install --prefix "$STAGING" --no-save --no-package-lock --ignore-scripts \
  --include=optional --omit=dev "@openai/codex@$VERSION"

validate() {
  local package="$1/node_modules/@openai/codex/package.json"
  local binary="$1/node_modules/.bin/codex"
  [[ -f "$package" && -x "$binary" ]] || { echo "Codex installation incomplete" >&2; return 1; }
  local installed cli_version
  installed="$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version)' "$package")" || return 1
  [[ "$installed" = "$VERSION" ]] || { echo "Codex package version mismatch" >&2; return 1; }
  cli_version="$("$binary" --version)" || { echo "Codex CLI version check failed" >&2; return 1; }
  [[ "$cli_version" = "codex-cli $VERSION" ]] || { echo "Codex CLI version mismatch" >&2; return 1; }
}

# Refuse a wrong candidate before any installed file is touched.
validate "$STAGING" || exit 1

# Replace installed package files only with a fully validated candidate, keeping the prior
# installation parked until the replacement is confirmed.
had_previous=0
if [[ -e "$MODULES" ]]; then
  mv "$MODULES" "$PREVIOUS"
  had_previous=1
fi
if ! mv "$STAGING/node_modules" "$MODULES"; then
  if (( had_previous )); then
    mv "$PREVIOUS" "$MODULES" || echo "Warning: prior installation remains parked at .node_modules.previous" >&2
  fi
  exit 1
fi
if ! validate "$RUNTIME_DIR"; then
  rm -rf "$MODULES"
  if (( had_previous )); then
    if ! mv "$PREVIOUS" "$MODULES"; then
      echo "Warning: prior installation remains parked at .node_modules.previous" >&2
      exit 1
    fi
  fi
  exit 1
fi
if (( had_previous )); then
  rm -rf "$PREVIOUS"
fi
printf 'Codex %s installed at %s\n' "$VERSION" "$RUNTIME_DIR"
