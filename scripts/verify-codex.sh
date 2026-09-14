#!/usr/bin/env bash
set -euo pipefail

# Reproducible Linux/orb acceptance. No account connection or production writes.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WRANGLER_SEND_METRICS=false

npm ci --no-audit --no-fund
npm run types
bash scripts/setup-codex.sh
node --test tests/setup-codex.test.mjs
node scripts/probe-codex.mjs
npm test
npm run test:runtime
npm run test:e2e
node scripts/test-codex-native.mjs
node scripts/test-codex-tools.mjs
node scripts/test-codex-tools.mjs --dynamic
npm run build

printf '%s\n' '{"status":"passed","scope":"credential-free Codex and control contracts","assistantOperational":false,"productionAdmission":false,"modelJudgmentVerified":false}'
