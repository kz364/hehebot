# Hehebot agent handoff

Hehebot uses direct Codex app-server **0.154.0** only. It has a durable external control plane and a sleeping single-runtime design. It is not deployed or operational; credentials were locally verified, but authenticated inference and production settlement are unverified.

## Resume

1. Read `AGENTS.md`, `README.md`, `SPEC.md`, `PRODUCT_UX_SPEC.md`, `docs/PROJECT_INTENT.md`, and `docs/IMPLEMENTATION.md`.
2. Run:

   ```sh
   bash .agents/setup
   bash scripts/verify-codex.sh
   npm ci --prefix desktop
   npm test --prefix desktop
   ```

3. Report current output without carrying forward old test totals. Scripted model fixtures are execution-contract evidence only.

## Boundary ownership

| Boundary | Ownership |
|---|---|
| `src/worker/`, `src/core/`, `DB/` | Durable ingress, identities, revisions, policies, schedules, memory, effects, locks, epochs, and leases |
| `runtime/codex-*` and journal modules | Pinned app-server transport, native event identity, submit/steer/cancel uncertainty, and scoped tools |
| supervisor/bridge and Sprite modules | Claim/submission custody and provider activity; production assembly remains unfinished |
| `public/`, `desktop/` | Portal and remote-only Electron shell; desktop is not an execution authority |

## Next work

The owner permits a root and native descendants to share one admitted task's grant. The pinned `--child` native fixture verifies inherited MCP tools and real task-scoped Worker receipts after parent completion; dynamic-tool inheritance remains unavailable. Child command/MCP observations now use exact thread/turn namespaces. Do not confuse task-level authorization with per-child caller authentication or completed invocation observations with effect settlement. See `docs/NATIVE_ORCHESTRATION.md` and `docs/CODEX_RUNTIME_SETUP.md`.

The disposable [service composition](CODEX_SERVICE.md) now exercises native child
owner-cancel delivery through its actual supervisor facade and Worker heartbeat.
Unknown coverage still blocks completion and sleep. [Portable templates](PORTABLE_TEMPLATES.md)
provide selected, authority-stripped offline import plans, not complete backups.
Live Sprite Tasks hold/renew/delete evidence is recorded in `docs/PROVIDERS.md`;
it does not prove service sleep, resume or crash recovery.

1. Production service assembly and complete operation accounting.
2. Owner-authorized authenticated inference, restart, refresh, quota, and no-fallback proof.
3. Recursive child/tool/effect settlement and exact targeted cancellation at supported interfaces.
4. Intent-aware orchestration and complete task/recovery/streaming UX.
5. Connector, browser, and actual Mac acceptance.
6. Backup/restore, portable state, provider lifecycle, cost, and staged release gates.

Preserve exact task identity and unknown outcomes. A root turn is not settlement. Never copy credentials between orbs, patch the runtime, edit runtime-owned databases, enable production gates to make a demo pass, or treat connector catalog presence as callable authorized effects.
