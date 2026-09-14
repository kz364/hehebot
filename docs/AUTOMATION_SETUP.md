# Browser, desktop and primary messaging setup

Decision record, 2026-09-13. These are recommended upstream integrations, not a claim of model-driven acceptance. OpenClaw 2026.9.3 packages substantially more than bare Pi. Keep the native agent loop and install/configure its supported capabilities; do not patch Pi or OpenClaw.

## Prefer the native browser; qualify desktop control separately

| Integration | Fit for this installation | Selection and limits |
| --- | --- | --- |
| [OpenClaw browser](https://docs.openclaw.ai/tools/browser) + bundled `browser-automation` skill | Native browser ownership, Playwright-backed snapshots/actions, tabs, screenshots, uploads/downloads and persistent managed profiles | **Default.** Included in the pinned package; no marketplace skill installation required. Chromium and its OS libraries must be provisioned and tested. |
| [OpenClaw CUA computer](https://docs.openclaw.ai/nodes/computer-use) | Desktop screenshots, windows/elements, keyboard/pointer actions through the native `computer` tool | **Qualified for synthetic Linux X11 tasks in two orbs.** Bundled, experimental and opt-in. Needs glibc Linux, verified driver artifacts and a paired node advertising `computer.act` and `screen.snapshot`. General cancellation/settlement is not proved. |
| [Peekaboo](https://docs.openclaw.ai/platforms/mac/peekaboo) | Native Mac desktop control through the paired OpenClaw app | **Mac default candidate.** Requires Accessibility, Screen Recording/Event Posting and an unlocked Mac. App-native computer control does not require the separate Peekaboo CLI. Mac-only acceptance remains a final hardware check. |
| [Agent-browser](https://github.com/vercel-labs/agent-browser) | Compact browser CLI/MCP, current-version skills, deterministic browser QA | **Development tool and optional fallback.** Preinstalled version 0.37.1 used in this orb. No independent model auth is needed for CLI operations. Production adoption needs a pinned install and the same resource/effect guards as native tools. |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Maintained browser tool server with persistent or isolated profiles and accessibility-tree control | Good alternative when a native browser capability is missing, but overlaps the existing Playwright-backed tool. Do not install a second browser owner by default. Its maintainers also recommend CLI + skills for many coding-agent workflows. |
| [Browser Use](https://github.com/browser-use/browser-use) | Offers both a CLI for existing agents and a Python/hosted agent | Evaluate its **CLI** if a concrete native-browser failure warrants comparison. The Python/hosted agent adds another agent loop/model connection and is not the default. Hosted browser/model services carry separate cost/auth. |

There is no independent benchmark here establishing a universal “best” integration. Selection prioritizes native policy/lifecycle integration, maintenance, persistent sessions, supported upstream updates, and avoiding another agent loop. Vendor benchmark claims are not Clawbot task acceptance.

The pinned npm package was inspected directly: it contains `dist/extensions/browser/openclaw.plugin.json`, `dist/extensions/browser/skills/browser-automation/SKILL.md`, `dist/extensions/cua-computer/openclaw.plugin.json`, and the optional Mac Peekaboo skill. Current website documentation sometimes splits pages differently from the installed release; validate configuration against the actual pinned CLI.

## Custom setup must preserve one browser owner

`bash scripts/setup-local.sh` installs the pinned native package containing these plugins. `bash scripts/setup-desktop.sh` adds Debian/Ubuntu orb X11 prerequisites; `node scripts/verify-local.mjs --desktop` runs the complete credential-free suite with an isolated supervised synthetic desktop. [Orb verification](ORB_TESTING.md) describes the evidence. These commands do not grant access to a personal desktop or claim a browser-ready production image.

The existing `config/remote-gateway.json` already enables a headless managed browser with `defaultProfile: "openclaw"`. During native executor setup:

1. Provision Chromium plus required OS libraries in the reproducible runtime image. Use the orb's installed Chrome for Testing while debugging; do not assume its filesystem path exists on Sprites or another VM.
2. Keep the `browser` plugin enabled and grant `browser` using the selected persona's supported `tools.alsoAllow` setting. The `coding` profile alone excludes it. Subagent allowlists cannot override a profile-level denial.
3. Use a dedicated persistent managed profile, not the owner's existing personal profile. Bind task tabs to exact identities and serialize shared account/profile actions through application resource locks. A profile is not a security boundary.
4. Do not let agent-browser, Playwright MCP and OpenClaw launch concurrent writers against one user-data directory. Optional tools require separate explicit profiles and lifecycle accounting.
5. Keep Chromium sandboxing and native private-network restrictions enabled. Test-only loopback fixture access must not become a production-wide private-network allowance. Native URL checks are not a complete egress firewall.
6. Preserve native skill loading rather than copying version-specific skill text into this repository. Never install an unreviewed marketplace skill or blindly run its setup commands. No cloud browser, account/profile copy, CAPTCHA bypass or connector permission is implied.

For Linux desktop qualification, the pinned documentation specifies:

```sh
openclaw plugins enable cua-computer
openclaw doctor --lint --only cua-computer/driver-artifacts
openclaw node run
```

Run those only against the deliberately isolated native test configuration and a supervised X11/D-Bus session. `probe-desktop.mjs` has now exercised the driver doctor, native node pairing and named computer RPCs in two orbs, with no package changes. Its synthetic configuration disables SSH verification only for its isolated test node and allows exactly the two computer commands; do not reuse it as personal pairing policy. The packaged SDK owns native driver artifacts; do not download a separate CUA daemon or patch failed hashes. Tool policy and node-pairing approval are separate gates. General computer control is a broad permission, not automatic per-action approval.

CUA's current Linux limits include primary-display-only control, no held-pointer/held-key desktop operations, rejected modifier-held clicks/drags, and incomplete Wayland support. Test an X11 fixture rather than silently translating refusals into foreground retries. Mac permission grants cannot be validated by Linux browser emulation.

## The dedicated portal is the owner messaging channel

**Use Clawbot's authenticated portal to message Chief of Staff and the other bots. WhatsApp is a scoped connector, not the primary command channel.** Cloudflare accepts durable messages while the shared Gateway sleeps. Chief of Staff is the default seeded conversation. No phone pairing is needed to send a portal message.

The existing path is `public/app.js` → `POST /v1/commands` (`message.send`) → installation Durable Object → durable receipt/run. Timeline reads use `/v1/conversations/:id/events`. The browser does not receive the native Gateway token. The missing executor must submit to the native coordinator, persist result attribution and recover event gaps; the portal currently shows a truthful waiting state instead of manufacturing replies.

Upstream [Control UI](https://docs.openclaw.ai/web/control-ui) / [WebChat](https://docs.openclaw.ai/web/webchat) is a useful **operator diagnostic interface**, not the sleeping-runtime ingress replacement. It requires an awake Gateway, authenticated WebSocket connection and appropriate device pairing/scopes. Do not expose raw Gateway/CDP ports or disable device authentication to make an external preview work. Native WebChat `chat.send` acknowledgments are admission, not finished execution or confirmed transcript persistence.

Orb browser check: selected Chief of Staff, entered a synthetic message using the labelled composer, sent it, then reloaded. The timeline contained exactly one identical user message; the runtime/sign-in waiting banner remained visible. This proves the dedicated portal's local persistence, **not a native assistant reply**. The inspected screenshot is `.amp/in/artifacts/primary-chat.png`. Production Access sign-in and externally reachable deployment remain unconfigured.

The later `test-native-bridge.mjs` connects real portal HTTP ingress and SQLite transitions to a real native tool turn and persists exactly one assistant reply across Worker restart. Its local scripted model, FakeProvider and explicit fixture settlement are acceptance scaffolding, not an operational service. The production portal still waits for a verified supervisor.

## Acceptance before another VM

Debug in orbs first. Require native model/tool tests for multi-step forms, stale-element recovery, multi-tab isolation, upload/download content, profile persistence across restart, login/manual handoff, cancellation during browser work, effect dedupe, desktop frame invalidation and complete sleep blocking. Test primary-portal messages while a browser child is active: status/new work must not change that child's input; explicit steering must target it exactly.

Native browser forms, dynamic fields, independent tabs, upload/download content, wrong-target lookup and profile storage persistence have passed in two orbs. Native Linux CUA input/frame/timeout recovery has passed in two orbs. Managed tabs close with the Gateway, and desktop timeout recovery does not prove action settlement. Neither limitation should be hidden by a successful fixture.

Only after the required native integration gates pass should another VM platform require manual account/provisioning and final image checks. Do not ask the owner to debug application behavior there. Native managed model authorization remains a dependency for intelligent model-backed acceptance; deterministic loopback-provider tests cover execution behavior without it.
