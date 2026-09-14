# Hehebot — portable sleeping assistant

The sleeping-assistant implementation now lives in `src/`, `public/`, and `runtime/`. It provides a local Cloudflare Worker portal, SQLite Durable Object command store and scheduler, fenced lifecycle controller, and provider adapters. **Execution is disabled; nothing has been deployed.**

Repository: [kz364/hehebot](https://github.com/kz364/hehebot). Existing `clawbot` package, application and storage identifiers are retained for compatibility; renaming the repository does not migrate installed state.

The selected initial harness is **Codex app-server 0.154.0**, behind our external orchestration boundary. [Direct Codex setup](docs/CODEX_RUNTIME_SETUP.md) installs and probes the pinned runtime without credentials or inference. [The optional desktop shell](desktop/README.md) displays the remote portal without running an agent on the client. Existing OpenClaw adapters and acceptance scripts remain reference evidence, not direct-Codex verification.

Selected runtime: **Fly Sprites**. The portal includes a reviewed batch import for five bots and seven disabled routines, plus task-specific follow-up/cancel controls. See [bot setup](docs/BOT_SETUP.md) and [native orchestration gates](docs/NATIVE_ORCHESTRATION.md). Follow [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md) for accounts, trial activation, credentials and owner sign-in.

Start with [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for local commands, tested scope, and remaining native-runtime gates. [SPEC.md](SPEC.md) describes the target behavior; it is broader than the current implementation.

For repeatable direct-Codex verification in a Linux orb, run `bash scripts/verify-codex.sh`. It installs dependencies, generates Worker types, verifies the pinned Codex runtime, and runs setup, core, runtime, HTTP, native, MCP, dynamic-tool and supervisor fixtures plus a build dry run. Native fixtures use scripted loopback model responses; they do not establish authenticated model judgment or production readiness.

For historical OpenClaw/browser/desktop verification, run `bash .agents/setup`, `bash scripts/setup-local.sh`, `bash scripts/setup-desktop.sh`, then `node scripts/verify-local.mjs --desktop`. Omit desktop setup and the flag for headless checks. [Setup and verification](docs/ORB_TESTING.md) records the limits; [browser/desktop and dedicated messaging](docs/AUTOMATION_SETUP.md) records the reference integrations. The portal is the owner messaging channel; WhatsApp is not required for primary chat.

## Documentation map

- [Full specification](SPEC.md) and [project intent / decision history](docs/PROJECT_INTENT.md).
- [Bot experience additions](PRODUCT_UX_SPEC.md): portal/task/routine requirements; direct-Codex implementation is in progress, not feature-complete.
- [Implementation plan](IMPLEMENTATION_PLAN.md) and [implemented versus pending](docs/IMPLEMENTATION.md).
- [Bot instructions and routines](docs/BOT_ROUTINE_INSTRUCTIONS.md), [bot setup](docs/BOT_SETUP.md), and [intent-aware orchestration and interruption](docs/BOT_ORCHESTRATION_ADDENDUM.md).
- [Grok behavior audit and parity gaps](docs/GROK_PARITY.md), [multi-orb verification and Amp model testing](docs/ORB_TESTING.md), and [coding-agent context](AGENTS.md).
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
