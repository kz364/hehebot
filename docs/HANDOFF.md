# Hehebot agent handoff

This file holds **only the current section** (≤ ~120 lines). It is replaced, not
appended to, at each checkpoint. Earlier handoffs are in
[archive/HANDOFF_HISTORY_2026-09.md](archive/HANDOFF_HISTORY_2026-09.md) and are
historical only.

## Current: v2-architecture resume (2026-09-27)

### What changed and why

The owner resumed implementation with a new direction: [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md)
(normative). The earlier plan to "resume at F3/E01/E02 recursive recovery" is
**cancelled**. That track produced ~150 commits of custody hardening while the owner
still couldn't chat with a bot during a background task. See the traps in
[AGENTS.md](../AGENTS.md). The new direction:

- **A1:** the agent speaks only through `hehebot_send_message`. The Worker commits
  each call, and a committed message is final.
- **A2:** stale executors are fenced by epoch at the Worker. A successor starts after
  an atomic epoch advance plus a same-machine flock kill, with no proof of process
  death.
- **A3:** interrupted is terminal for an attempt. Continuation is a new seeded
  attempt. Only live current-generation work blocks sleep.
- **A4:** the coordinator routes with task tools. Task events wake the coordinator.
- **A5–A7:** the portal gets a durable outbox, a streamed WebSocket timeline and a
  clean thread (bubbles only for messages).

### Start here

1. Branch **`v2-architecture`** (from `source-custody` @ `b930d21`). `main` is stale.
2. Read `AGENTS.md` → `ARCHITECTURE_V2.md` → the V rows at the top of `TODO.md`.
3. Toolchain: Node ≥ 22.16, then `npm ci` and `npm run types`.
   - Focused checks: `npm run typecheck`, `npx vitest run tests/<file>.test.ts` and
     `node --test tests/runtime-<file>.mjs`.
   - The full `bash scripts/verify-codex.sh` needs the Linux Codex binary, so it runs
     in Linux containers, not on macOS.
   - **Known macOS baseline:** 7 backup/export vitest files fail on macOS before any G
     work (no `age` binary; `UNSAFE_PATH` from the space in the path or the
     `/private/tmp` symlink): `backup-control`,
     `control-backup-creation`, `control-backup-pruning`, `control-export-import`,
     `control-restore-inspection`, `encrypted-control-backup`, `owner-auth-binding`
     (1 case). All other files pass: 2,246 tests.
   - **Runtime suite on macOS:** `npm run test:runtime` hangs on macOS in
     `runtime-process-lock.mjs` and `runtime-hosted-owner-unused.mjs` (Linux flock/process-group
     semantics; still fails with Homebrew `flock`/`util-linux`), and several codex-service cases
     fail because `build-codex-service.sh` needs the Linux Codex binary. Run focused runtime files
     individually on macOS; run the full runtime suite on Linux. V3's lock work needs Linux evidence.
   - **Browser fixtures on macOS:** `npm i -g agent-browser && agent-browser install`, plus
     `bash scripts/setup-codex.sh && bash scripts/build-codex-service.sh` for the codex manager
     fixtures. Already failing at `d1a9906` (baseline, not G work): test-portal-{connector-catalog,
     memory-delete, memory-edit, memory-inspect, output, recovery, routine-delete, skill-draft,
     skill-references, skill-review, skill-run, skill-task-proposal, steering, task-cancel}
     (several flaky) and the RETIREMENT_REPORTED / HOSTED_WAKE_OUTCOME_UNKNOWN assertions in
     test-codex-{background,hosted,warm}-manager.
4. Pick the lowest open V row whose dependencies are merged (waves are listed in TODO).
5. **V8 hosted runbook (owner-authorized only; branch `g8-hosted-wiring`; rehearse first: `node scripts/test-v2-e2e.mjs`).**
   Never touch the existing production Sprite or the `hehebot-portal` Worker; everything below is a fresh `hehebot` Worker/DO (`hehebot.kaspar-zhou.workers.dev`) and a fresh Sprite.
   - Secrets: `python3 scripts/setup-secrets.py --generate` (RUNTIME_TOKEN, SPRITE_WAKE_TOKEN) and `--store PROVIDER_TOKEN` (Sprites org token, kaspar-hidayat).
     Create Cloudflare Access apps `hehebot` (owner-only, the `hehebot.kaspar-zhou.workers.dev` hostname) and `hehebot-internal` (runtime-only, service-auth), plus a
     dedicated service token `hehebot-runtime`; note the apps' issuer, AUD and your `sub`, and store the token's client ID/secret at
     `~/.hehebot-secrets/access-client-id` and `~/.hehebot-secrets/access-client-secret` (0600).
   - Sprite: `~/.local/bin/sprite create hehebot-test -o kaspar-hidayat`; `sprite exec -s hehebot-test` to install Node ≥22.16 and the repo at
     this branch, run `bash scripts/setup-codex.sh && bash scripts/build-codex-service.sh`, `codex login --device-auth` into the chosen nativeHome, write a
     0600 `HEHEBOT_V2_CONFIG` JSON (portalOrigin, token files, the `~/.hehebot-secrets/access-client-id`/`access-client-secret` files, ownerBindingSha256,
     stateRoot, binary, nativeHome, personas),
     then inside the Sprite: `sprite-env services create hehebot --cmd bash --args "scripts/with-executor-lock.sh,<stateRoot>/lock,node,runtime/v2-service-entry.mjs" --http-port 8080 --dir <repo>`.
     Keep the Sprite URL auth at the default (`sprite`): the Worker's wake sends `Authorization: Bearer <PROVIDER_TOKEN>` plus `x-hehe-wake-token`.
     Sprites pause (unbilled) when idle and resume frozen services on the next request; a resumed stale process is fenced by epoch (A2).
   - Worker: `npx wrangler secret put {RUNTIME_TOKEN,PROVIDER_TOKEN,SPRITE_WAKE_TOKEN} --env hehebot`, then `npx wrangler deploy --env hehebot
     --var EXECUTION_ENABLED:true --var HEHEBOT_EXECUTION_MODE:v2 --var OWNER_SUB:<sub> --var ACCESS_ISSUER:<iss> --var ACCESS_AUD:<aud> --var
     PROVIDER_CONFIG:'{"provider":"fly-sprites","ref":{"provider":"fly-sprites","id":"hehebot-test"},"service":"hehebot","lifecycleVerified":true,"wakeUrl":"https://<sprite-url>/"}'`.
   - Scenario: ask for hotel research, ask a status question while it runs, see the result relayed, then confirm the Sprite sleeps (~65 s idle).
   - Cost: Sprite billed only while awake; Worker/DO on the free tier; model usage on the owner's ChatGPT plan; stays within the ≤$10 budget.
   - Rollback: redeploy `--env hehebot` with `EXECUTION_ENABLED:false` and empty `HEHEBOT_EXECUTION_MODE`, or `npx wrangler delete --env hehebot`; `sprite destroy hehebot-test`.

### Code map for the V rows

| Concern | Where |
| --- | --- |
| Command ingress | `src/worker/index.ts` (`POST /v1/commands`), `src/core/control.ts` (`message.send` → `message.user` event) |
| Runs/attempts/sleep | `src/core/lifecycle.ts`: `authorizeAttempt`, `complete()`, `active()` (sleep predicate), `watchdog()` (epoch-loss writes), `scheduleRetry` |
| Runtime RPC | `runtime/control-client.mjs` (principal allowlists) → `src/worker/index.ts` `/internal/**` → `src/worker/control-object.ts` `runtime()` switch |
| Host tools | `runtime/agent-tools.mjs` (stdio MCP server; `AGENT_TOOL_NAMES`, `COMMAND_TYPES`), schemas in `SCHEMAS/contracts.json` → `npm run generate:contracts` |
| Codex adapter | `runtime/codex-adapter.mjs` (`thread/start`, `turn/start`, `turn/steer`), `runtime/codex-service.mjs`, `runtime/execution-bridge.mjs` |
| Effects/locks | `src/core/effects.ts` (intent→dispatched→confirmed/failed/outcome_unknown), `src/core/resources.ts` |
| Schema | `DB/schema.sql` (v16), `src/core/migrations.ts` |
| Provisional output (to be demoted) | `src/core/output-preview.ts`; the portal merges `completed_reply`/`provisional_reply` in `control.ts` ~520 |
| Portal | `public/app.js`: `command()` ~295, `render()` ~379, 5 s refresh ~1203 |
| Hosted alpha entry | `runtime/owner-alpha-entry.mjs` `runHostedOwnerAlpha`, `runtime/hosted-owner-*.mjs`, `src/core/owner-alpha*.ts` |

### State

- V0–V7 are done locally on `v2-architecture` (not pushed); on Linux (test Sprite `hehebot-ci`,
  run tests attached — Sprites pause when idle) full vitest and the runtime suite pass except 3
  pre-existing setpriv cases. V8 local prep and `scripts/test-v2-e2e.mjs` pass. Next is **V8** (hosted alpha on the new path), which
  needs owner authorization: Worker deploy, live Codex calls, and Fly credentials (owner approved
  ≤ $10 Fly spend on 2026-09-27). `coordinatorInbox` is off by default until V8 enables it.
- The deployed portal and the Sprite are unchanged. The hosted trial work from
  2026-09-17 is still `recovery_required`: don't replay it.
- Production execution and native-verification flags remain false.
- Deployment, live model calls, spending, account connections and pushes each need
  explicit owner authorization.

### Checkpoint rule

At each checkpoint, update **one** place:
- the V row status in TODO.md,
- the commit message with its evidence,
- and this section only if the start-here, code map or state facts change.

Lead reports with what the owner can now do.
