#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT/scripts/build-codex-service.sh"
state="$(mktemp -d)"
# The Node fixture owns its own temporary state and cleanup. This separate lock
# directory exists for the complete fixture process, including native children.
trap 'rmdir "$state"' EXIT
bash "$ROOT/scripts/with-executor-lock.sh" "$state" node "$ROOT/scripts/test-codex-service.mjs" "$@"
