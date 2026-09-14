# Orb verification

Credential-free verification uses the supported setup scripts:

```sh
bash .agents/setup
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
git diff --check
```

Use `.agents/resume` after an orb restore. The Codex wrapper installs/probes app-server 0.154.0 in isolated private state and runs control-plane, runtime, HTTP, native lifecycle/tool/supervisor fixtures plus a build dry run. Scripted loopback responses exercise contracts without external model calls.

Passing this suite does not authorize deployment or prove authenticated inference, model judgment, account billing, live provider sleep, recursive settlement, real connectors, browser/mobile acceptance, or Mac hardware permissions. Local owner-auth bypass is loopback-only. Report pass/fail/skip and the current checkout's totals; do not preserve historical counts as a baseline claim.

Private fixture state and logs remain under ignored local directories. Do not transfer OAuth caches, connector state, databases, or personal data between orbs. A failed or timed-out side-effecting check may have an unknown outcome and must be inspected before retry.

## Portal history race checks

With the orb's installed `agent-browser` and Chromium:

```sh
node scripts/test-portal-history.mjs
node scripts/test-portal-history.mjs --error
```

These bounded fixtures render the actual portal against synthetic loopback history
responses. They delay Alpha's history, switch to Beta, then release either a
success or error. DOM assertions require Beta's messages to remain unchanged,
Alpha's response/error not to cross into Beta, and Alpha's history to remain
available on return. They make zero mutations and close their own browser/server.
This is interaction evidence, not real Worker/authentication or full UX acceptance.

The separate [two-root diagnostic](CODEX_TWO_ROOTS.md) deliberately exits 2 with
`WORKER_SINGLE_COORDINATOR_ADMISSION`; do not count it as a passing concurrency test
or suppress its blocked result in the normal verification wrapper.
