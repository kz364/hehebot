# Orb verification and Amp-managed model checks

## What can run without account setup

Clawbot control-plane tests need no Cloudflare account, provider token, OpenAI key or connector login. `.agents/setup` installs locked dependencies and generates Worker types; `.agents/resume` checks restored prerequisites. It does not install OpenClaw. The tested orb image supplied Node v26.5.1/npm 10.9.9; this is not a claim that the deployment's proposed Node 24 image was tested.

### Reproducible orb-first command

On a fresh orb, run the repository setup first, then install the exact native package and verify everything:

```sh
bash .agents/setup
bash scripts/setup-local.sh
bash scripts/setup-desktop.sh # Debian/Ubuntu orb X11 prerequisites
node scripts/verify-local.mjs --desktop
```

`setup-local.sh` installs `openclaw@2026.9.3` with npm `--ignore-scripts` under ignored `.local/native-execution`. It reuses an existing exact-pin install and refuses an unknown or version-mismatched directory rather than overwriting it. It does not read personal OpenClaw configuration or authentication. The top-level version is exact, but npm's transitive resolution is **not lockfile reproducible** because this isolated native install has no committed lockfile.

The verification runs unit, runtime, import, native-source and mocked Amp-smoke checks, HTTP E2E, real disk-backed Worker restarts, native agent/orchestration, portal-to-native reply persistence, browser acceptance, and build sequentially with time bounds. `--desktop` adds supervised X11/native CUA acceptance; without it the report explicitly says desktop was not requested. Desktop setup installs only OS prerequisites, not credentials or personal permissions. Native agent tests use a deterministic loopback OpenAI-completions fixture, not paid inference or Amp OAuth. It refuses a missing/wrong native pin and treats native-source skips as failure. Finally `probeGateway` checks real isolated Gateway health and confirmed shutdown. The final JSON says `assistantOperational:false`: passing fixtures cannot promote production gates. Private desktop evidence is retained under `.local/desktop-acceptance-*`; no personal installation is reused.

Do setup and debugging in orbs first. Other VM platforms are a final acceptance step **after native assistant acceptance passes in orbs**, not merely after the environment command passes. Manual platform account/provisioning steps may remain, but do not send the owner to another VM to debug application failures. Passing this command is not permission to enable feature gates, deploy, log in, patch OpenClaw, or call a live model/provider. When shutdown cannot be confirmed, verification fails and retains its private probe directory rather than deleting state a process may still own.

Run from the repository root:

```sh
bash .agents/resume  # use bash .agents/setup if prerequisites are missing
npm test
npm run test:runtime
node --test tests/bot-import.test.mjs tests/native-orchestration-contracts.test.mjs tests/amp-smoke.test.mjs
npm run test:e2e
npm run build
git diff --check
```

`npm test` selects TypeScript tests only. `test:runtime` selects `tests/runtime*.mjs`; the extra Node command above is necessary. Native source tests **skip** if the pinned package is absent. Report pass/fail/skip separately; a successful exit with five skips is not native compatibility proof. Build regenerates checked-in validators; inspect resulting diffs before keeping them. The HTTP script uses disposable SQLite state and cleans up its local Worker; it never invokes a model/provider or exercises browser interaction.

Local owner-auth bypass accepts loopback only. Do not expose it through an Amp portal or relax authentication to make a preview work. Production Access verification, native runtime auth and model OAuth are separate domains.

## Supported model route without copying OAuth

The project plugin `.amp/plugins/clawbot-smoke.js` uses the documented `amp.ai.generate` API with `ctx.thread.id`, explicit `openai/gpt-5.6-sol`, and a 256-output-token cap per request. Amp owns authentication and routing. No token is read, exported, stored in Clawbot, or transferred between orbs. Merely loading the plugin makes no model calls.

In an authenticated Amp thread:

1. Confirm the desired ChatGPT subscription in [Model Routing](https://ampcode.com/settings/model-routing). It is account-level setup, not a per-orb login. If strict subscription-only billing is required, confirm that policy in Amp before invoking the probe; its public plugin API exposes no subscription-only or paid-fallback control.
2. Ask Amp to load `.amp/plugins/clawbot-smoke.js` with `load_plugin`, then invoke `clawbot_model_smoke` once. Fresh threads with the file in their checkout load the project plugin normally. Unpushed parent files must be transferred explicitly to other orbs.
3. Expect two checks: explicit Jakarta weekday 08:00/read-only → `0 8 * * 1-5`, enabled, no sending; ambiguous Friday morning with hostile source text → empty cron, disabled, no sending. The fixture says its synthetic read connector is available; no real connector is accessed.
4. Inspect `amp threads usage THREAD_URL --details`. Record the model request count, subscription-use indicator, and credits. Aggregate subscription use and $0 credits are useful observations, not proof that every call used subscription OAuth or that later fallback is impossible.

The tool has fixed synthetic prompts, no agent tools, no HTTP proxy/listener, no arbitrary caller prompt, no application mutations and no retries. Model failure is reported as unknown; do not automatically repeat a potentially billed request. `node --test tests/amp-smoke.test.mjs` verifies wiring, wrong-result detection, redaction and no retries **without making model calls**.

**This is a model-contract probe, not an OpenClaw integration.** It does not validate real routine commands, inject instructions into the native harness, claim jobs, persist memory, dispatch tools, stream native events, or test cancellation/restart/refresh. A successful answer must never set `NATIVE_VERIFIED=true`. There is no established supported method here to give OpenClaw Amp's private OAuth tokens or use Amp as a drop-in OpenAI endpoint.

For production, retain [native managed OAuth setup](NATIVE_AUTH_SETUP.md) until a supported native provider adapter is implemented and independently proven. The [Amp SDK](https://ampcode.com/docs/sdk) runs the Amp agent; replacing the native executor with it would change the harness under test rather than prove OpenClaw compatibility. Do not launch nested agents from a test script to disguise this difference.

The real-model native acceptance blocker is the tool-capable model interface: `amp.ai.generate` supplies bounded text/structured completions, but its exposed options do not supply canonical tool calls, tool-result continuation, streaming or cancellation for an OpenClaw provider. This does **not** block credential-free native behavior tests: a supported custom loopback provider supplies scripted SSE/tool calls, and the real upstream agent executes them. That fixture measures execution contracts, not intelligent decisions. The pinned OpenClaw package documents `models auth login --provider openai --device-code` for its own managed subscription login. It requires owner consent and interactive account authorization, not credential extraction from Amp. No native login has been initiated here. Login would unblock real-model tests, not complete the still-missing supervisor by itself.

References inspected 2026-09-13: [Amp introduction/subscription connection](https://ampcode.com/docs), [Plugin API](https://ampcode.com/docs/plugin-api), and the installed `amp plugins show-docs` definitions for `PluginAIOptions` and `PluginAI.generate`.

## Multi-orb evidence, 2026-09-13

The parent fast-forwarded to the completed orb-setup change on `origin/main`. Independent orbs began from that same remote baseline; local regression/plugin files were transferred explicitly. These are isolated test environments, not replicas concurrently owning one live installation.

| Environment | Executed evidence | Limit |
| --- | --- | --- |
| [Control-plane orb](https://ampcode.com/threads/T-01a099f9-41d8-7099-8512-835bb98394b8) | Setup/resume passed; baseline 176 unit tests; 177 after adding sibling-routine memory isolation regression; 20 real local Worker/SQLite HTTP checks; build dry-run passed. | No native model or provider execution in these commands. |
| [Native-runtime orb](https://ampcode.com/threads/T-01a099f9-6c3f-75d8-8172-88f116213dbb) | Setup/resume passed; 45 runtime tests after probe regressions, four import tests, nine orchestration tests; five source checks passed after isolated pinned OpenClaw installation. | Initially five source checks skipped. Source/mock checks are not O01–O09. |
| Native-runtime orb, actual Gateway | OpenClaw 2026.9.3, protocol 4, `operator.read`, `healthOk:true`, `processStopped:true`; explicit post-probe port-free check. | Synthetic token and isolated state; zero inference and external sends. |
| Parent integration orb | 177 TypeScript tests; combined Node suite: 51 passed, five skipped (native package absent); 20 local HTTP checks; build passed. | Native package is deliberately not inherited from another orb. |
| Parent Amp model probe | Both fixed interpretation checks passed; usage showed two GPT-5.6 Sol requests, 351 input/78 output tokens, $0 Amp model credits; thread indicated ChatGPT subscription use. | Model-only; aggregate billing report, not per-call OAuth attestation. |
| Control-plane orb, transferred Amp model probe | Two plugin unit tests passed; both live fixed checks passed without extra login. Sol absent before, then two requests/351 input/78 output/$0; subscription indicator present. | Confirms a second independent orb can use managed thread routing; no native execution or per-call billing guarantee. |

The native orb installed `openclaw@2026.9.3` with `--ignore-scripts` into ignored `.local/native-verification`, set `OPENCLAW_PACKAGE_ROOT` for source tests, ran `runtime/probe.mjs` for static schema evidence, then called `probeGateway` from `runtime/probe-gateway.mjs` with a new private directory and unused loopback port. The native health helper refuses an existing state directory. Do not reuse a prior probe directory or a personal OpenClaw home. Its fresh synthetic Gateway process is bounded and stopped before returning; no long-lived native service was provisioned.

Follow-up setup acceptance: the parent and control-plane orb both ran the transferred `scripts/verify-local.mjs` successfully. The control-plane orb installed OpenClaw fresh using `scripts/setup-local.sh`. Each run passed 185 TypeScript tests (including eight new missed-alarm ingress regressions), 45 runtime, four import, five installed-source, two mocked Amp-smoke and two setup tests: **243 tests, zero skips**, plus 20 HTTP checks and the build. Each final report had `healthOk:true`, `processStopped:true`, zero inference/external sends, and `assistantOperational:false`. The second orb needed no implementation fixes. This is not other-VM or model-backed acceptance.

Testing found and fixed false-positive reporting in **our** `runtime/probe-gateway.mjs`: RPC transport success previously passed even with unhealthy data, unconfirmed shutdown did not downgrade success, and blocked reports exited zero. Nine subprocess regressions now require healthy data plus confirmed shutdown, nonzero blocked exits and sanitized errors. The initial regression run had six failures; all nine final cases pass. The fixed CLI also passed against the real pinned Gateway, exited zero, and left its port free. Failure-path tests use subprocess-local doubles; no OpenClaw package code was modified.

## What remains unverified

The native adapter rejects production submission with `COMPATIBILITY_GATE_BLOCKED`; the Sprite service reports `executor_ready:false`. Native orchestration and browser/desktop execution now have direct credential-free evidence below, but real-model intent resolution, typed routine tools, native memory/search isolation, general tool/effect settlement, live Sprite wake/idle, OAuth restart/refresh, live connectors, coordinated restore and cost acceptance remain open. Full mobile/accessibility acceptance is not established; no UI appearance was changed.

See [Grok parity](GROK_PARITY.md) for the behavioral map and concrete coverage gaps. These results establish repeatable development checks and a credential-free-per-orb model probe, not an operational personal assistant.

## Completed orb acceptance checklist, 2026-09-13

| Requested area | Executed evidence | Boundary |
| --- | --- | --- |
| Portal → executor → persisted reply | `test-native-bridge.mjs`: seven assertions, actual HTTP/SQLite Worker, pristine native `read` tool, terminal/tool/history evidence, exact one reply and dedupe after Worker restart; two loopback model calls | Process-local test flags, FakeProvider, adapter testMode and fixture-specific settlement; not a deployed supervisor |
| Coordinator/background isolation and interruption | `test-native-agent.mjs`: 16 assertions, 12 loopback model calls, native isolated quiet child at main=1/subagent=1, available coordinator, exact child abort, deferred followup execution, interrupt/replacement, steer at tool/model boundary | Parent and independent control orb passed. Scripted responses do not prove model intent/target judgment or arbitrary child tree settlement |
| Browser forms/tabs/files/persistence | `test-native-browser.mjs`: seven assertions, exact asymmetric form payload, dynamic fields/upload, unaffected sibling tab, exact downloaded bytes, wrong-target rejection, localStorage after Gateway/browser restart | Parent and control orb passed. Managed Chrome closes with Gateway; live tab IDs do not survive. No personal login or arbitrary form continuation proved |
| Linux computer use | `probe-desktop.mjs`: native CUA screenshot/window/accessibility, background typing preserving focus/pointer, exact foreground input, stale-frame rejection, unsupported held-input rejection, timeout/recovery, execution close | Parent and native orb passed. Background effect reported unverifiable despite independently observed mutation; timeout recovery is not SDK cancellation/settlement proof. Inspected screenshot: `.amp/in/artifacts/native-desktop-after.png` |
| Lifecycle/restart/locks/unknown effects | 100 seeded SQLite/controller interleavings: 87 invalidated stops, 13 committed stop/wake sequences; exact cancellation, sibling locks, stale epochs, bounded retry and schedule boundaries. `test-control-restart.mjs`: 18 HTTP requests, two real workerd restarts, persisted dedupe and exact cancellation | Controller/FakeProvider evidence is not actual Sprite suspension. Native bridge journal tests refuse uncertain resubmission after reconstruction |
| Synthetic connector workflow | Seven effect tests including structured flight source → pinned policy → due-leg restore → durable destination receipt and reconstruction/dedupe | Fake destination, not Gmail/calendar connector. Fixed effect-key reuse with changed classification, authorization or provider key |

Combined baseline after integration: **313 TypeScript + 58 Node tests = 371 tests, zero skips**, plus 20 HTTP E2E checks, the restart/native acceptance scripts above, and build dry-run. Test counts are not full specification acceptance.

The thin `runtime/execution-bridge.mjs` keeps durable claim/submission/completion custody. Eight regression cases cover acknowledged and ambiguous transitions, exact result retry, settlement/identity rejection, stale epoch, and the production gate. It assumes a single fenced writer and a trusted settlement producer. It does not implement process ownership, scheduled heartbeats, complete native event reconciliation or autonomous provider sleep. Those are **unfinished implementation**, not account-setup blockers.

Actual external blockers: owner native model authorization for intelligent/refresh tests; live provider credentials and explicit provisioning for Sprite semantics; connector accounts for real history/effects; physical Mac and permissions for Mac-only operations. Native limits observed above separately block claims of universal browser continuation and computer-action settlement. No OAuth cache was copied, upstream package patched, production gate enabled in tracked configuration, account connected, or external message sent.
