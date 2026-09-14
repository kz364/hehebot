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
