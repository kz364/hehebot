# Clawbot — personal OpenClaw assistant

The sleeping-assistant implementation now lives in `src/`, `public/`, and `runtime/`. It provides a local Cloudflare Worker portal, SQLite Durable Object command store and scheduler, fenced lifecycle controller, and provider adapters. **Execution is disabled; nothing has been deployed.**

Selected runtime: **Fly Sprites**. The portal includes a reviewed batch import for five bots and seven disabled routines, plus task-specific follow-up/cancel controls. See [bot setup](docs/BOT_SETUP.md) and [native orchestration gates](docs/NATIVE_ORCHESTRATION.md). Follow [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md) for accounts, trial activation, credentials and owner sign-in.

Start with [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for local commands, tested scope, and remaining native-runtime gates. [SPEC.md](SPEC.md) describes the target behavior; it is broader than the current implementation.

## Documentation map

- [Full specification](SPEC.md) and [project intent / decision history](docs/PROJECT_INTENT.md).
- [Implementation plan](IMPLEMENTATION_PLAN.md) and [implemented versus pending](docs/IMPLEMENTATION.md).
- [Bot instructions and routines](docs/BOT_ROUTINE_INSTRUCTIONS.md), [bot setup](docs/BOT_SETUP.md), and [non-interrupting orchestration](docs/BOT_ORCHESTRATION_ADDENDUM.md).
- [Authentication checklist](docs/AUTH_SETUP.md), [native/Mac authentication](docs/NATIVE_AUTH_SETUP.md), and [setup record](SETUP.md).
- [Publication and verification snapshot](docs/PUBLICATION.md).

The repository includes all project source, tests, contracts and documentation. Credentials, private identity profiles, raw personal exports, local databases/browser state and generated dependency/build caches are excluded.

## Earlier remote-Gateway setup

One authoritative VPS Gateway owns sessions, memory, automations, credentials and a persistent browser. The Mac companion provides optional browser, files, shell and desktop capabilities over a paired private connection. **No VM has been provisioned or contacted.**

- [SETUP.md](SETUP.md): actual changes, verification, remaining actions, undo.
- [docs/REMOTE.md](docs/REMOTE.md): eight-step deployment, network, state inventory, backup, recovery and updates.
- [docs/LOCAL.md](docs/LOCAL.md): Mac setup, permissions, two browser modes, test procedure.
- `config/`: tracked, secret-free machine templates; `agent/`: portable user/agent material.
- `scripts/`: thin upstream command wrappers; no orchestration or OpenClaw fork.
- `tests/`: local form and upload fixture. `.local/`: ignored private test state/evidence.

Installed CLI: `~/.local/share/openclaw/bin/openclaw`, linked from `~/.local/bin/openclaw`.
Mac app: `~/Applications/OpenClaw.app`.
Active Mac config: `~/.openclaw/openclaw.json` (remote mode, future endpoint pending).

Do not run `openclaw onboard --install-daemon` on the Mac: this topology reserves the persistent Gateway for the VPS. Follow `docs/REMOTE.md` when the VM exists.
