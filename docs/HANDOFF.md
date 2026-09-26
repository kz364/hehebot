# Hehebot agent handoff

This file holds **only the current section** (≤ ~120 lines). It is replaced, not
appended to, at each checkpoint. Earlier handoffs are in
[archive/HANDOFF_HISTORY_2026-09.md](archive/HANDOFF_HISTORY_2026-09.md) and are
historical only.

## Current: Grok-alignment resume (2026-09-27)

### What changed and why

The owner resumed implementation with a new direction: [GROK_ALIGNMENT.md](GROK_ALIGNMENT.md)
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

1. Branch **`grok-alignment`** (from `source-custody` @ `b930d21`). `main` is stale.
2. Read `AGENTS.md` → `GROK_ALIGNMENT.md` → the G rows at the top of `TODO.md`.
3. Toolchain: Node ≥ 22.16, then `npm ci` and `npm run types`.
   - Focused checks: `npm run typecheck`, `npx vitest run tests/<file>.test.ts` and
     `node --test tests/runtime-<file>.mjs`.
   - The full `bash scripts/verify-codex.sh` needs the Linux Codex binary, so it runs
     in Linux containers, not on macOS.
   - **Known macOS baseline:** 8 backup/export vitest files fail on macOS before any G
     work (no `age` binary; `UNSAFE_PATH` from the space in the path or the
     `/private/tmp` symlink): `backup-control`, `backup-retention`,
     `control-backup-creation`, `control-backup-pruning`, `control-export-import`,
     `control-restore-inspection`, `encrypted-control-backup`, `owner-auth-binding`
     (1 case). All other files pass: 2,246 tests.
   - **Runtime suite on macOS:** `npm run test:runtime` hangs on macOS in
     `runtime-process-lock.mjs` and `runtime-hosted-owner-unused.mjs` (Linux flock/process-group
     semantics; still fails with Homebrew `flock`/`util-linux`), and several codex-service cases
     fail because `build-codex-service.sh` needs the Linux Codex binary. Run focused runtime files
     individually on macOS; run the full runtime suite on Linux. G3's lock work needs Linux evidence.
4. Pick the lowest open G row whose dependencies are merged (waves are listed in TODO).

### Code map for the G rows

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

- G0 (docs and guardrails) is done. G1 onward is in progress; see TODO for the
  per-row state.
- The deployed portal and the Sprite are unchanged. The hosted trial work from
  2026-09-17 is still `recovery_required`: don't replay it.
- Production execution and native-verification flags remain false.
- Deployment, live model calls, spending, account connections and pushes each need
  explicit owner authorization.

### Checkpoint rule

At each checkpoint, update **one** place:
- the G row status in TODO.md,
- the commit message with its evidence,
- and this section only if the start-here, code map or state facts change.

Lead reports with what the owner can now do.
