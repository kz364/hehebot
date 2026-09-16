# Bounded owner background native prerequisite

`scripts/test-codex-owner-background.mjs` is a credential-free behavioral prerequisite for a future bounded owner-background path. It runs pristine Codex app-server **0.154.0** against a scripted loopback Responses endpoint in a disposable home and workspace. It performs no account login, actual model/provider call, Worker/service admission, connector action, or production activation.

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

The host must still choose and durably bind the single background-capable root;
enabling this override for every independent root would permit one child per root,
not one installation-wide background child. Current owner-alpha policy, service
and Worker admission remain root-only. Integrating a separately opt-in bounded
policy must preserve exact task grants, shared deadlines, all-family operation
accounting, cancellation, quota and unknown outcomes before any live use.

## Non-claims

This is not evidence of an app-server-global child cap, tool/effect settlement, real authentication or model judgment, service/control-plane integration, safe sleep, recursive termination beyond observed cleanup, filesystem sandbox completeness, provider behavior, or production readiness. Production execution/native-verification flags remain false.
