# Personal OpenClaw: remote Gateway, intermittent Mac

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
