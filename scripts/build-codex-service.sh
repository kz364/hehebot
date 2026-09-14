#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# esbuild is installed by the locked Wrangler dependency tree. Bundle the public
# first-party TS provider module rather than copying its Tasks implementation or
# relying on Node's incomplete TS/extensionless-import execution support.
"$ROOT/node_modules/.bin/esbuild" "$ROOT/src/providers/sprites.ts" --bundle --platform=node --format=esm --target=node22 --outfile="$ROOT/.local/codex-service/sprites.mjs"
