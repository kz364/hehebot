# Owner browser takeover

Status: implemented with local tests (2026-09-28). **Live verification is pending.**

A browser task that reaches a login, CAPTCHA or verification code asks the owner to do that step. The owner watches the
runtime's browser live in the portal, clicks and types in it, and hands it back. The bot then continues from the page it
gets back.

## Flow

1. The model calls the gateway tool `browser_request_takeover {reason}`. The gateway's blocker note (a login, CAPTCHA or
   2FA page) tells it to do this.
2. The gateway creates a takeover id and sends the runtime RPC `browser-takeover {action:'open', takeover_id, reason,
   timeout_ms}`. The Worker checks the attempt (epoch, boot, and that the run is running on this attempt). It stores a record
   under `runtime_metadata['browser-takeover:<id>']` and appends a `notice`:
   `{kind:'needs_you', reason:'BROWSER_TAKEOVER', run_id, attempt, persona_id, takeover_id, expires_at, detail, message}`.
   Push notifications can key on that notice.
3. The gateway dials out to `GET /internal/takeover/stream?takeover_id&run_id&attempt&epoch&boot_id`. It authenticates
   like every other runtime call: `Authorization: Bearer <runtime token>` plus the Access service-token headers. The
   Sprite is not reachable from outside, so the connection is outbound only.
4. The portal renders the notice with a **Take over browser** button. The button opens a full-screen viewer on
   `GET /v1/takeover/stream?takeover_id` (owner Access and same-origin, like `/v1/stream`).
5. The Durable Object pairs the two sockets by the tag `takeover:<id>` (WebSocket Hibernation) and relays frames between
   them. The runtime screencasts only while a viewer is connected.
6. The tool returns when the owner clicks **Hand back to bot** or **Cancel**, or when the takeover times out (default
   10 min). The result is text: "The owner handed the browser back. Current page: "<title>" <url>. Take a fresh
   browser_snapshot…", or "The owner did not take over within N min…". The gateway then sends `browser-takeover
   {action:'end', outcome}`. The Worker marks the record ended, closes both sockets and posts
   `notice {kind:'runtime', reason:'BROWSER_TAKEOVER_ENDED', takeover_id, outcome}`. The portal uses that notice to retire
   the button.

## Browser process (changed)

The gateway now launches Chromium itself: the pinned `chromium_headless_shell-*` under `browser.dir/browsers`, started with
`--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`. The port comes from `DevToolsActivePort`. Playwright MCP
0.0.82 is started with `--cdp-endpoint <ws>` (its CLI supports `--cdp-endpoint`/`--cdp-header`). This lets the takeover
relay attach as a second CDP client to the same pages.

- **OOM:** Chromium and Playwright MCP still set `oom_score_adj=1000`. Codex stays at −900.
- **No orphans:** Chromium runs in its own process group under a small `sh` supervisor. If the gateway dies (its stdin
  pipe closes) or Chromium exits, the supervisor kills the whole group. A real-Chromium test SIGKILLs the gateway and
  checks this.
- **Restart on hang:** unchanged. A failed or timed-out call restarts both processes, and the next call relaunches them
  lazily.
- **Profiles:** by default each attempt gets a fresh profile under its output dir, deleted on stop. This matches the old
  `--isolated`. With `browser.persistentProfiles: true` (runtime config), each persona gets
  `<stateDirectory>/browser-profiles/<persona_id>`, so an owner login survives across tasks.
  - A lock file (`<profile>.lock`, holding the owner pid, reclaimed when that pid is dead) allows one attempt at a time
    per profile. A second attempt gets "profile in use".
  - Persistent profiles close gracefully (CDP `Browser.close`, then SIGKILL after 5 s) so cookies reach disk.
- **Port exposure:** the DevTools port listens on loopback only. Codex's permission profile has networking disabled, so
  model-run shell commands cannot reach it. Only the gateway and Playwright MCP connect to it.

Rejected alternative: `--remote-debugging-pipe`. Playwright MCP and the relay would then need one multiplexed CDP stream,
and each client's Target auto-attach events would reach the other client.

## Runtime relay (`runtime/browser-takeover.mjs`)

- **Page choice:** the relay attaches (flattened session) to the newest page. A page created during the takeover, such as
  an OAuth popup, becomes the one shown. A closed page falls back to the newest remaining one.
- **Screencast:** CDP `Page.startScreencast` produces JPEG at quality 60, at most 1280×1280.
  - An immediate `captureScreenshot` shows a still page.
  - Frame acks are delayed, which caps the rate at 5 fps.
  - A frame is dropped when the relay socket has more than 1 MiB buffered.
  - A frame over 900 KB is dropped and quality steps down to 30.
- **Page info:** url and title are sent as `meta` frames. They are re-read from `Target.getTargetInfo`, because
  `targetInfoChanged` is not reliable for title changes.
- **Input:** each input is validated again and mapped to `Input.dispatchMouseEvent` (press, release, move, wheel),
  `Input.dispatchKeyEvent`, `Input.insertText` or `Page.navigate`.
  - Coordinates arrive normalized to 0..1 and are scaled to the CSS viewport.
  - Ctrl/Alt/Meta chords are sent as raw keys without text.
  - The runtime accepts at most 60 inputs per second.
- **Keeping the task alive:** `progress` is sent at the start and every 30 s. The stuck-task watchdog (5 min) never fires
  during a takeover.
- **Sprite awake:** the supervisor's maintenance loop renews the Sprites activity hold while the run is live, and the
  blocking tool call keeps the turn live. This was verified in `execution-supervisor.mjs` `maintain()`.
- **Codex timeout:** Codex's MCP `tool_timeout_sec` for `hehebot_browser` is set to takeover timeout + 60 s. Codex's 60 s
  default would otherwise cut the tool off.
- **Worker-side operation watchdog (fixed live 2026-09-28):** the runtime's own heartbeat also projects every open MCP
  call as an `operations` entry the Worker's `watchdog()` (`src/core/lifecycle.ts`) can mark `DEADLINE_EXCEEDED` if it
  outlives its deadline. That deadline defaulted to a flat two minutes for every MCP call (`codex-operations.mjs`), same
  as an unclocked shell command -- so even with the Codex-side `tool_timeout_sec` above correctly raised, the Worker
  cancelled the run out from under the owner about two minutes into a takeover. `codex-service.mjs` now declares an
  explicit `mcpCallTimeoutsMs: { browser_request_takeover: <takeover timeout + 60 s> }`; `codex-adapter.mjs` records
  each MCP call's tool name once, at its first observed item (`mcpCallTools`, forwarded by `codex-events.mjs`'s
  `project()`); and `codex-operations.mjs` looks up a named tool's declared timeout instead of the generic default,
  same mechanism as the existing `shellOperationTimeoutMs` override for clocked shell commands.
- **While the owner has control,** every other browser tool call is refused with a tool error. At most 3 takeovers are
  allowed per attempt.

## Frames

| Direction | Frame |
| --- | --- |
| runtime → viewer | binary JPEG (≤ 1 MiB at the Worker); `{t:'meta',url,title,w,h}`; `{t:'end',outcome}` |
| Worker → viewer | `{t:'peer',runtime:bool[,reason,expires_at]}`, `{t:'error',code:'INVALID_INPUT'}` |
| Worker → runtime | `{t:'viewer',connected:bool}` |
| viewer → runtime | `{t:'mouse',type:'down'\|'up'\|'move',x,y,button?,clicks?,mods?}`, `{t:'wheel',x,y,dx?,dy?}`, `{t:'key',type:'down'\|'up',key,mods?}` (a single printable character or a named key), `{t:'text',text}` (≤ 1000), `{t:'navigate',url}` (http/https only, no credentials), `{t:'handback'}`, `{t:'cancel'}` |

The Worker parses and re-serializes every viewer frame (`src/core/browser-takeover.ts`); it never forwards raw viewer
bytes. It allows 60 input frames per second per viewer and ≤ 4 KiB per text frame. The runtime validates again with an
identical validator, and a vitest checks that the two agree. Nothing a viewer sends can run script, open `file:`, `data:`
or `javascript:` URLs, or reach any CDP method other than the four input mappings above.

## Security checks

- **Runtime socket:**
  - The runtime token is required (`verifyRuntimeToken`), and so is Cloudflare Access with the service token.
  - The route exists only on the ordinary (v2) control plane: it returns 404 when an owner-alpha
    bootstrap/warm/background generation or a hosted owner alpha is configured.
  - The DO requires a live takeover (waiting, unexpired, run `running` on that attempt), matching run, attempt, epoch and
    boot, and `lifecycle.authorizeAttempt` (current generation, unexpired lease).
- **Viewer socket:**
  - Owner Access authentication and same-origin, the same as `/v1/stream`.
  - A live takeover id is required. Unknown, ended and expired ids get 404 before the upgrade.
  - Connection attempts are rate-limited per minute.
- **One viewer at a time:** a newer viewer replaces the older one, which is closed with 4001 "Opened in another window".
  The same applies to a reconnecting runtime.
- **Effects:** owner input is the owner's own action, so no effect-ledger entries are made for it. Bot actions stay fenced
  as before.
- **Sensitive input:** keystrokes and text typed by the owner, such as passwords, are relayed and never logged or stored.

## Portal

Rendered by `public/takeover.js` and opened from the notice in `public/app.js`.

- A full-screen overlay with a canvas; frames are decoded with `createImageBitmap`, so the CSP is unchanged.
- A status line shows: connecting, waiting for the bot's browser, "You have control; the bot is waiting", handed back,
  cancelled, timed out, or opened in another window.
- Controls: **Hand back to bot**, **Cancel**, **Close viewer** (the bot keeps waiting), and an http(s) address bar.
- On desktop, the canvas captures the mouse, the wheel and keys.
- On a phone, tapping works through pointer events, and there is a text field with Send text / Enter / ⌫ / Tab buttons.

## Tests

- `tests/runtime-browser-takeover.mjs`: validation, CDP mapping, and the fake-CDP state machine (frames, fps cap,
  backpressure, popups, hand-back, cancel, timeout, progress, rate limit). Also relay framing and headers, the gateway tool
  (notice, progress, blocking, no effects, cap), `--cdp-endpoint` launch arguments, restart, and the profile lock.
- Real Chromium, skipped with a printed reason when `.local/browser` or `HEHEBOT_TEST_BROWSER_DIR` is missing:
  - click-through-screencast and hand-back
  - no orphan after the gateway is killed
  - the portal viewer in Chromium
  - persistent-profile cookies surviving a restart
- `tests/browser-takeover.test.ts`: the validators agree, the open notice, Worker route auth, DO pairing, piping, limits,
  the single-viewer policy, clean close on end, and expiry.

## Live verification (integrator)

1. Deploy the Worker and redeploy the runtime from this branch. `scripts/setup-browser.sh` needs no change.
   - Node ≥ 22 is required on the Sprite for the global `WebSocket` with `headers`.
   - Optionally set `browser.persistentProfiles: true` in the runtime config.
2. Ask a browser-granted persona to open a page that needs a login. Expect a "Needs you … in its browser" notice, with the
   Worker `progress` rows continuing every 30 s.
3. In the portal, click **Take over browser**. Check that the frames are live and that you can click, type and scroll.
   Complete the login, then click **Hand back to bot**. The bot should continue on the logged-in page, and a "You handed
   the browser back" notice should appear.
4. Repeat with **Cancel**, and once with no action to check the timeout. On a phone, check viewing, tapping and the text
   field.
5. With persistent profiles on, start a second task for the same persona and confirm it is still logged in.
