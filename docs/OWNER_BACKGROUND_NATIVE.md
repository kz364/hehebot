# Bounded owner background native prerequisite

**Live background entry is blocked.** Pinned V1 tools can target another live root
when given its raw thread ID. Spawn capacity/depth and host cancellation routing
do not enforce independently admitted task authority. The scripted checks below
remain useful lifecycle evidence, not permission to use V1 background mode live.
`runOwnerAlpha` refuses it before filesystem/service/account work with
`OWNER_BACKGROUND_AUTHORITY_UNVERIFIED`. Default root-only alpha is unchanged.

`scripts/test-codex-owner-background.mjs` is a credential-free behavioral prerequisite for the bounded owner-background path. It runs pristine Codex app-server **0.154.0** against a scripted loopback Responses endpoint in a disposable home and workspace. This native-only fixture performs no account login, actual model/provider call, Worker/service admission, connector action, or production activation. A separate integrated service check is documented below.

## Contract under test

The persistent app-server configuration remains root-only. One root, **A**, alone receives this supported `thread/start.config` override:

```json
{
  "agents": {
    "enabled": true,
    "max_concurrent_threads_per_session": 1,
    "max_depth": 1
  },
  "features": {
    "multi_agent": true,
    "multi_agent_v2": false
  }
}
```

This targets the V1 behavior in pinned [Codex source](https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340): the concurrent-thread setting (legacy alias `max_threads`) counts spawned children within each root tree, excludes the root, and each independent root owns separate control state. The fixture does not infer those semantics from configuration acceptance: it requires actual spawn behavior and per-thread feature readback.

Pinned sources: [configuration fields](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/config/src/config_toml.rs#L687-L709), [root-scoped control](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control.rs#L124-L147), [child reservation/root exclusion](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/registry.rs#L95-L156), and [release after shutdown](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/legacy.rs#L5-L43). A completed child root alone does not release its V1 slot. This source finding is not independent effect settlement proof. V2 is explicitly off: its count includes the root, depth semantics differ, and it has residency eviction behavior. Do not generalize this V1 fixture to V2.

Root A spawns one direct child. The child remains blocked in scripted inference after it attempts a forbidden grandchild. While that child is active, A attempts a second child and must receive a native capacity denial. Independent root **S** starts without an override, retains root-only defaults, rejects an actual unsupported spawn call, and completes independently. The fixture records exact root/child native identities and interrupts the held child before process shutdown.

The named `owner-background` profile is the owner-alpha shape without an ELF allowance: `:minimal` and the disposable workspace are readable; disposable private-home, journal, and token paths are denied; network is disabled. Config readback must preserve that profile, empty MCP servers, disabled provider-facing features, and root-only defaults. A and S explicitly select the same named profile. Codex 0.154.0 exposes per-thread feature and child-source readback, but not an equivalent per-child resolved filesystem-profile RPC; inheritance evidence is therefore bounded to named-profile selection at root start, unchanged global profile readback, child provenance, inherited feature readback, and restricted tool catalogs—not a claim of complete filesystem containment.

RPC `approvalPolicy: "untrusted"` is used. The unsupported top-level TOML form is not used.

## Run and interpretation

```sh
node --check scripts/test-codex-owner-background.mjs
node scripts/test-codex-owner-background.mjs
git diff --check -- scripts/test-codex-owner-background.mjs docs/OWNER_BACKGROUND_NATIVE.md
```

Success reports the exact native denial strings, scripted outputs, model-request count, identities, readback summaries, interruption, closed held request, stopped native process, and byte-identical original config. Raw protocol/model traffic remains private and is deleted with the temporary directory.

A failure is an explicit prerequisite gap. Do not relax a denial, enable another tool/provider surface, or modify runtime/core/gates to make this fixture pass.

## Observed pinned result (2026-09-16)

The strengthened host fixture exited 0 with seven scripted model requests and zero external model calls. Root A returned `ROOT_A_CAP_DENIAL_VISIBLE`; its second spawn returned exactly `collab spawn failed: agent thread limit reached`. Both the direct child's attempted grandchild and root S's attempted child returned exactly `unsupported call: spawn_agent`. Root S independently returned `ROOT_S_DEFAULT_DENIAL_VISIBLE` while the original child remained held. Both root messages were verified by exact persisted `thread/read` content, not merely copied from scripted output constants. Catalog absence alone is not counted as a native denial.

Per-thread readback was `multi_agent=true, multi_agent_v2=false` for A and its child, and both false for S. Child source named A's exact thread as parent at depth 1. The run used distinct A, child, and S thread/turn identities; those UUIDs are intentionally emitted per run rather than treated as stable documentation. Cleanup interrupted the exact held child turn, observed zero active turns and one of one held HTTP request closed, then observed the native process stopped. The pre/post config SHA-256 values were identical. Host evidence: `.local/owner-background-native-host.log`.

Enabling this override for every independent root would permit one child per root,
not one installation-wide background child. The service integration below selects
only one root durably. Default owner alpha remains root-only.

## Non-claims

This is not evidence of an app-server-global child cap, tool/effect settlement, real authentication or model judgment, service/control-plane integration, safe sleep, recursive termination beyond observed cleanup, filesystem sandbox completeness, provider behavior, or production readiness. Production execution/native-verification flags remain false.

## Opt-in service integration (2026-09-16)

An immutable owner-alpha policy may explicitly add `background_first_root: true`.
Only literal true is accepted when present; absence preserves old serialization
and root-only behavior. `admitted_run_ids[0]` selects the first durably admitted
coordinator within the existing atomic claim/quota transaction. Only that claim
carries `owner_alpha_background: true`; the bridge maps it to the native input's
`ownerAlphaBackground: true`. The service compares the input against persisted
claim and policy. The adapter captures it before awaits, fingerprints it, and
merges the exact agents/features override with the original task MCP config.
No model text, family ordering or root completion can select another root.

The ledger accepts same-persona direct observations under that selected root,
with the exact parent attempt, boot/epoch, native receipt, ancestry and inherited
deadline checked on authorization and reconstruction. Children do not consume
root quota. This is a concurrent native cap, not a one-child-ever allowance;
observed child bookkeeping must not discard later or cancelled work. Late
observations remain cancelling; owner/context revocation takes precedence over
deadline expiry. Root cancellation propagates before authenticated callbacks and
watchdog processing, preserving grace anchors and unknown operations. Repeated
already-propagated cancellation performs no writes.

Read-MCP calls share the admitted root's immutable logical-task grant; their
receipts are task-level, not authenticated per-child provenance. Mutations,
effects, complete and sleep remain denied. No live session has used this option.

Run `bash scripts/test-codex-service.sh --owner-alpha-background`. Host result
`.local/owner-background-integration-final.log` passes seven loopback requests:
actual browser message → private HTTPS Worker/SQLite → selected native root/child,
successful inherited routine read, independent status reply with exact A summary,
actual status-root spawn denial, reload without inference, separate B admission,
exact B and old-A cancellation, three retained families and25 heartbeat operations.
It verifies three root admissions plus one child, distinct immutable grants,
unchanged global root-only config, no provider holds, three unknown coverage
records, no run.result and denied sleep. Both native fixtures are now in the
combined verifier. This is scripted service/control integration, not real-model
judgment, complete settlement, live hosted readiness or production acceptance.

## Cross-root authority blocker

Pinned V1 `send_input` uses global [get_thread](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control.rs#L200-L228)
without local registry membership; `close_agent` also globally
[looks up and shuts down the supplied ID](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/legacy.rs#L46-L98).
V1 `wait_agent` can subscribe to foreign status. UUID secrecy is not authority.
There is no public per-tool filter to retain spawn while removing these V1 tools;
the [V1 tool set is fixed](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/spec_plan.rs#L655-L689).
This is pinned-source evidence; the initial native fixture did not attempt it.

V2's message/follow-up [delivery](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/delivery.rs#L72-L107)
and [interrupt](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/interrupt.rs#L25-L54)
paths check `ensure_agent_known` before global access. This is a candidate, not an
adopted replacement: V2 capacity/depth/residency and actual foreign-ID denials
need behavioral verification before changing the service. No dependency patch,
prompt-only restriction or guessed-ID assumption is an acceptable fix.

The combined verifier passed 1,297 control/380 runtime tests and all scripted
checks, including root cancellation reaching its held child, in
`.local/owner-background-combined.log`. The subsequent live-entry gate passes
24 focused tests in `.local/owner-background-live-gate.log`; the full combined
suite was not repeated for that gate. Both results retain all production flags
false and do not resolve this authority blocker.
