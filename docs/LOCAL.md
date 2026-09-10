# Local Mac operation and tests

## Installed layout

- CLI upstream stable **2026.9.3 (1391f7c)**, official prefix installer, private Node **24.19.0**: `~/.local/share/openclaw/`. Default `~/.local/bin/openclaw` is a symlink to its upstream wrapper.
- Signed companion **2026.9.3**, build **2609000390**: `~/Applications/OpenClaw.app`. `codesign --verify --deep --strict` and Gatekeeper assessment completed successfully.
- Active Mac config: `~/.openclaw/openclaw.json`, based on `config/mac-node.json`, remote mode. No permanent Gateway or separate node LaunchAgent was installed.
- Private Mac app credentials are supplied through `openclaw-mac primary set --token-file`; they are not tracked here. Runtime device identity/state is private under `~/.openclaw`; app-local settings/Keychain are machine-specific.
- The test app used a `setup-test` profile and a loopback Gateway at 19789. It is not the future authoritative instance.

## Connecting later

Install/sign in to Tailscale on the Mac and VPS, enable tailnet HTTPS, then run:

```bash
scripts/connect-mac.sh wss://ACTUAL-HOST.ACTUAL-TAILNET.ts.net /private/path/gateway-token
```

Use the actual hostname and private mode-600 token file. The native app's primary connection owns node capabilities; merely adding a saved dashboard Gateway is insufficient. Approve its identity/capabilities on the VPS, confirm `openclaw nodes status`, and test the two browser locations. Do not install a second headless node unless you intentionally need CLI-only operation.

## Browser and computer permissions

The managed `openclaw` browser has its own persistent profile. It does not automatically inherit Chrome logins. The `chrome-live` existing-session profile prepares the separate signed-in-browser mode. Official Chrome integration uses a native helper and Store extension:

```bash
openclaw browser extension install
openclaw browser extension status --json
```

Extension setup was **not executed**: automatic approval review requires the user's explicit extension-setup approval. Chrome may require its own final approval. Do not export cookies or copy the user's entire Chrome profile to the VPS. Cookie import/sync is optional and has not been enabled.

In System Settings → Privacy & Security, enable **Accessibility** and **Screen Recording** for OpenClaw to test desktop screenshot/click/typing. Enable Computer Control in OpenClaw's This Mac capabilities if required. Screen Recording was false in the node's reported permissions and `screen.snapshot` failed. No TCC database edits or permission bypasses were attempted. Camera, microphone, location and other unrelated permissions are not required for the form tests.

The current native app directly advertises `computer.act`, `screen.snapshot`, browser proxy, filesystem, MCP and system commands. No extra Peekaboo installation or custom MCP is needed for this baseline. Capability advertisement is not proof that permission-gated execution works. See [Mac app](https://docs.openclaw.ai/platforms/macos), [remote mode](https://docs.openclaw.ai/platforms/mac/remote), [browser](https://docs.openclaw.ai/tools/browser), and [computer paths](https://docs.openclaw.ai/platforms/mac/peekaboo).

## Explicit browser routing

`gateway.nodes.browser.mode: "manual"` in the remote template avoids silently choosing an online Mac for routine browsing. Use the agent browser tool's explicit node target for Mac work and Gateway/host target for remote work. With CLI testing, `browser` commands can automatically route to a node in auto mode. The disposable Gateway uses mode `off` to exercise its own isolated browser; this does not disable the Mac's own browser capability. Keep browser/CDP ports private. Do not disable browser sandboxing on the Linux VM.

## Reproduce the benign test

1. Run `scripts/local-test-gateway.sh` in a terminal; Ctrl-C stops it and its idle-sleep guard.
2. In a second terminal run `caffeinate -i python3 -m http.server 19880 --bind 127.0.0.1 --directory tests`.
3. In another shell set `export OPENCLAW_STATE_DIR="$PWD/.local/gateway"`; use `scripts/claw browser start`, `scripts/claw browser open http://127.0.0.1:19880/form.html`, and `scripts/claw browser snapshot`.
4. Use fresh snapshot refs with `browser fill --fields '[{"ref":"…","value":"Ada Test"},…]'`, `select`, `click`, and `type`. Fill name/email/date, choose Research, check consent, click Next, and fill the dynamically created note.
5. Copy `tests/upload.txt` into `/tmp/openclaw/uploads/`, then `browser upload /tmp/openclaw/uploads/upload.txt --input-ref <ref>`. Click Finish and inspect the resulting JSON. Use `browser screenshot --full-page` and `browser download <download-ref> openclaw-test-download.txt`; verify `/tmp/openclaw/downloads/openclaw-test-download.txt`.
6. Optionally connect the app with `openclaw-mac --profile setup-test primary set --direct-url ws://127.0.0.1:19789 --token-file "$PWD/.local/test-token"`. Use `nodes status`, `nodes invoke --node 'MacBook Pro' --command system.which --params '{"bins":["sh"]}'`, and `fs.listDir` for read-only node checks. Test normal `exec host=node` through a configured agent after selecting/authenticating a model.
7. Stop the browser (`browser stop`), Ctrl-C the Gateway/server, clear the test app primary connection (`openclaw-mac --profile setup-test primary clear`), and restore the Mac template if needed. Keep all test state in ignored `.local/`; do not migrate it to the VPS.

Tests use OpenClaw's actual browser controls, not a substitute automation library. No inference provider was configured and no paid API calls were made. Thus these demonstrate deterministic tool capabilities, not unattended model-driven reliability on every website.

## Stable-release differences discovered

- Per-profile `color` and `gateway.tailscale.resetOnExit` shown in some docs are rejected by this stable schema; removed from templates.
- The legacy `configure-remote --profile` path did not isolate config as expected; use the verified `primary set` interface. Test changes to the default config are removed during cleanup.
- `nodes invoke system.run` is reserved; stable requires the agent `exec` tool with `host=node`. The direct HTTP test did not expose exec; automatic review rejected broadening the test tool profile. Full shell execution is **not verified**.
- `fs.listDir` returned successfully but listed no entries for the files-only test folder. This proves RPC reachability, not file-content read/write or end-to-end file transfer.
