#!/usr/bin/env bash
set -euo pipefail

# Reproducible Linux/orb acceptance. No account connection or production writes.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export WRANGLER_SEND_METRICS=false

npm ci --no-audit --no-fund
npm run types
bash scripts/setup-codex.sh
bash scripts/setup-age.sh
node --test tests/setup-codex.test.mjs
node scripts/probe-codex.mjs
npm test
npm run test:runtime
node scripts/test-control-backup-restore-drill.mjs
node --test tests/audit-wappmcp-licenses.mjs
node --test macos/tests/*.test.mjs
node scripts/verify-wappmcp.mjs
node --test tests/wappmcp-prepare.mjs
npm run test:e2e
node scripts/test-owner-alpha-successor-worker.mjs
node scripts/test-hosted-wake-transport.mjs
node scripts/test-portal-token-usage.mjs
node scripts/test-portal-connector-catalog.mjs
node scripts/test-portal-skill-draft.mjs
node scripts/test-portal-skill-references.mjs
node scripts/test-portal-skill-task-proposal.mjs
node scripts/test-portal-skill-run.mjs
node scripts/test-portal-skill-history.mjs
node scripts/test-portal-routine-history.mjs
node scripts/test-portal-routine-preflight.mjs
node scripts/test-owner-alpha-gateway.mjs
node scripts/test-portal-alpha-session.mjs
node scripts/test-portal-alpha-warm-portal.mjs
node scripts/test-portal-alpha-background.mjs
node scripts/test-control-questions.mjs
node scripts/test-control-whatsapp.mjs
node scripts/test-control-crash.mjs 2
node scripts/test-codex-native.mjs
node scripts/test-codex-crash-readback.mjs
node scripts/test-codex-capacity.mjs
node scripts/test-codex-permissions.mjs
node scripts/test-codex-owner-alpha.mjs
node scripts/test-codex-owner-alpha.mjs --profile-overrides
node scripts/test-codex-owner-alpha.mjs --text-only
node scripts/test-codex-owner-background.mjs
node scripts/test-codex-owner-background-v2.mjs
node scripts/test-codex-owner-background-v2.mjs --v2-model-catalog
node scripts/test-codex-owner-background-v2.mjs --v2-model-catalog --terminal-root-mailbox
node scripts/test-codex-steering.mjs
node scripts/test-codex-questions.mjs
node scripts/test-codex-tools.mjs
node scripts/test-codex-tools.mjs --child
node scripts/test-codex-tools.mjs --grandchild
node scripts/test-codex-tools.mjs --dynamic
node scripts/test-codex-tools.mjs --supervisor
node scripts/test-codex-tools.mjs --supervisor-child
bash scripts/test-codex-service.sh
node scripts/test-codex-hosted-owner.mjs
node scripts/test-codex-hosted-manager.mjs --browser
node scripts/test-codex-warm-manager.mjs
node scripts/test-codex-warm-manager.mjs --browser --wake-first
node scripts/test-codex-warm-auto-stop.mjs
node scripts/test-codex-warm-auto-stop.mjs --pending-maintenance
node scripts/test-codex-background-manager.mjs --browser
bash scripts/test-codex-service.sh --text-only
bash scripts/test-codex-service.sh --owner-alpha-multi
bash scripts/test-codex-service.sh --owner-alpha-background
bash scripts/test-codex-service.sh --submission-ack
bash scripts/test-codex-service.sh --operation-pages
bash scripts/test-codex-service.sh --reasoning
bash scripts/test-codex-service.sh --plan
bash scripts/test-codex-service.sh --plan-child
bash scripts/test-codex-service.sh --history
bash scripts/test-codex-service.sh --history-child
bash scripts/test-codex-service.sh --questions
bash scripts/test-codex-service.sh --questions-cancel
bash scripts/test-codex-service.sh --child
bash scripts/test-codex-service.sh --child-effects
bash scripts/test-codex-service.sh --crash
npm run build

printf '%s\n' '{"status":"passed","scope":"credential-free Codex and control contracts","assistantOperational":false,"productionAdmission":false,"modelJudgmentVerified":false}'
