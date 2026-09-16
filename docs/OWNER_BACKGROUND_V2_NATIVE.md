# Codex V2 target-authority prerequisite

**Credential-free native fixture passed on 2026-09-16; live owner-background entry remains blocked.** This is executable evidence for the pinned binary and synthetic `fixture-model`, not authenticated model behavior, a universal depth guarantee, logical-child settlement, or live-alpha authorization. Do not clear `OWNER_BACKGROUND_AUTHORITY_UNVERIFIED` or production/native-verification flags based on this fixture alone.

## Reproduce without credentials

```sh
bash scripts/setup-codex.sh  # only if the pinned runtime is absent
node --check scripts/test-codex-owner-background-v2.mjs
node scripts/test-codex-owner-background-v2.mjs
```

The script exits nonzero on any failed native assertion and prints a redacted JSON report. Broader unproved gates remain explicitly false even on a scoped pass. It has a 90-second watchdog, bounded request/response waits, a 40-request ceiling, and an exact successful request count of 23. No installed dependency, runtime implementation, control-plane code, or production config is changed.

Base: host unpublished [main at 79d93fd](https://github.com/kz364/hehebot/commit/79d93fdb10008902d84d814b84a8bc0c65a85360), imported from the host bundle rather than `origin/main`. The unpublished commit link may not resolve until the host publishes it. Bundle SHA256: `80779407cdecd60dcc2b56da90a547b33eef1d02c5a74b5c5cefa4ea6240b817`. Scaffolding came from the host's reference `scripts/test-codex-owner-background.mjs`, retained only in ignored local storage. The two new files are the entire patch.

Runtime: pristine npm-installed `codex-cli 0.154.0`; Linux x64 native executable SHA256 `3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022`. Source review used upstream [6b9826e](https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340). No upstream implementation was copied or patched.

## Exact configuration and its limits

Global defaults are `agents.enabled = false`, `features.multi_agent = false`, and `features.multi_agent_v2 = false`. Only A receives this supported `thread/start.config` override:

```json
{
  "agents": { "enabled": true },
  "features": {
    "multi_agent": false,
    "multi_agent_v2": {
      "enabled": true,
      "max_concurrent_threads_per_session": 2,
      "wait_agent_enabled": false
    }
  }
}
```

The correct V2 field is `features.multi_agent_v2.max_concurrent_threads_per_session`. It includes the root; `2` leaves one resident child slot. `agents.max_concurrent_threads_per_session` is a compatibility input with different counting semantics; this fixture does not use it. Native denial of a second direct child is tested while the first child is actively waiting on its model HTTP response. V2 can evict idle residents, so this is **not a limit on the total number of logical children** and not an app-server-global limit.

There is no V2 `max_depth` field in the pinned feature schema. `agents.max_depth` is checked by V1; V2 child collaboration tools depend on model metadata. Here the synthetic model advertises no V2 model metadata: A has the V2 collaboration catalog, but its child has none. Both plain and `collaboration`-namespaced child spawn attempts fail natively. **A model-independent no-grandchild policy remains a prerequisite gap.** Do not extrapolate this result to a real model advertising V2 support.

V2 `wait_agent` has only `timeout_ms` and waits for caller mailbox activity, not a foreign UUID target. It remains explicitly disabled; catalogs assert its absence. V2 has no `close_agent`; plain legacy control calls and the explicit `multi_agent_v1` namespace are exercised as unsupported calls. Legacy close/send probes use the supported `target` field; resume uses its supported `id` field. The report records each model call's arguments and namespace, not just the response.

Relevant pinned sources: [`features/src/feature_configs.rs`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/features/src/feature_configs.rs), [`core/src/config/mod.rs`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/config/mod.rs), [`core/src/tools/spec_plan.rs`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/spec_plan.rs), and [`core/src/agent/control/residency.rs`](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/residency.rs). Source review informs these limitations; it is not substituted for the native denial checks.

## Executed authority and concurrency checks

S is created first and held in active inference. A's scripted **model function calls** receive S's actual native UUID, not a random/nonexistent ID. Host `turn/interrupt` is used only for cleanup; the positive authority test uses model-controlled `interrupt_agent`.

| Check | Required native observation |
| --- | --- |
| A spawns child | `{"task_name":"/root/child_a"}`; native source identifies A as parent and depth 1 |
| Second active direct child | `collab spawn failed: agent thread limit reached` |
| Child attempts grandchild | `unsupported call: spawn_agent` and `unsupported call: collaborationspawn_agent` |
| Foreign `send_message`, `followup_task`, `interrupt_agent` | Each returns `agent with id <actual-S-UUID> not found` |
| Plain V1 `close_agent`, `send_input`, `resume_agent` | Exact `unsupported call: <name>` |
| Namespaced V1 close/send/resume/spawn | Exact `unsupported call: multi_agent_v1<name>`; native formatting has no separator |
| Registry before/after all foreign attempts | Exactly `/root` and `/root/child_a`, both running; no S adoption/leakage |
| S isolation | Identical persisted turns and thread events; one model request; original turn active and HTTP response still open |
| Same-tree `send_message` | Empty native success output, no extra child inference or interruption |
| Same-tree `interrupt_agent` | `{"previous_status":"running"}`; exact child turn interrupted and held HTTP response closed |
| Same-tree `followup_task` | Empty success output; new child turn and HTTP request containing the authorized follow-up |
| Independent S response | `ROOT_S_INDEPENDENT` completes while child follow-up inference remains active |
| Persisted A output/activity | `ROOT_A_AUTHORITY_CHECKED`; all four subagent activities target only the actual child |
| Cleanup | Both child turns read back interrupted; zero active turns; all three held HTTP responses closed; server closed; native process stopped |

Two consecutive final runs passed. The recorded run used S `01a0ab39-0d21-7e22-944e-d172b7978c7f`, A `01a0ab39-0dd3-7961-ba86-ad328062267f`, child `01a0ab39-0e76-7952-bd35-6e45f78cfa35`. All three foreign responses were exactly `agent with id 01a0ab39-0d21-7e22-944e-d172b7978c7f not found`. The report preserves exact turn IDs, child source identity, outputs, and supported `thread/read` results. UUIDs and hashes vary across runs.

## Readback, containment, and remaining gaps

`config/read` before and after is identical. It confirms root-only global defaults; empty MCP servers; web search, apps, plugins, tool suggestion, image generation, standalone web search, remote models, code mode, token-budget and permission-expansion features disabled. Analytics and feedback read back disabled; all three OTEL exporters read back `none`.

The permission profile reads back exactly `:minimal = read`, disposable workspace `read`, and private-home/journal/token paths `deny`, with network disabled and no ELF/system-binary read allowance. A and S `thread/start` read back `approvalPolicy: untrusted`, `sandbox: {type: readOnly, networkAccess: false}`, and active profile `{id: owner-background, extends: null}`. This verifies configuration, not a separate adversarial filesystem/shell escape test.

`experimentalFeature/list` reads back V2 enabled for A and child, disabled for S; V1 is disabled for all three. The child feature bit alone does not imply that its model has collaboration tools. `config/read` has no per-thread selector in this protocol: the numeric per-thread cap is recorded as **requested configuration plus native behavioral evidence**, not misrepresented as numeric thread-config readback. The supported thread readback contains final messages, child activities and turn statuses, but not every model tool's raw result; exact tool outputs are captured separately from the subsequent loopback requests.

The config file's before/after SHA256 matched (`0086f535d27a49bf0c98664ec4def3e55e4e36ccc526be1f844973490ac62339` in the recorded run). Disposable home/workspace and raw model/protocol material are removed in `finally`. Only synthetic, path-redacted evidence is printed. `spawnCodex` supplies a scrubbed environment and disposable HOME/CODEX_HOME. The sole configured inference provider is unauthenticated loopback with retries disabled. The sandbox's network-disabled flag governs tool execution; it does not block the app-server's intentional loopback model transport. This is configuration/observed-request evidence, not packet-level egress attestation.

No real model, account, credential, connector, or cloud provider was used. This fixture does not authorize live alpha, establish model judgment, prove restart continuity or recursive tool/effect settlement, or replace the host's independent integration review. The general depth policy and logical-child lifecycle remain unresolved even when the scoped fixture reports `passed`.

## Host integration and supported-config decision

The host verified the delivered patch/evidence SHA256 values and independently ran
the fixture on 2026-09-16. `.local/owner-background-v2-host.json` reports `passed`,
23 loopback requests, unchanged foreign-root turns/events/registry, zero active
turns, all three held HTTP requests closed, native stopped, and unchanged config.
No runtime V2 switch or live-entry gate change is included.

Pinned-source follow-through rules out using a child role as the missing depth
boundary. Children clone parent config ([child_config.rs lines 99–149](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/child_config.rs#L99-L149)).
Role projection permits only selected feature overrides, not `multi_agent_v2` or
`agents.enabled` ([role.rs lines 36–48](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/role.rs#L36-L48),
[lines 80–126](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/role.rs#L80-L126)).
A default role is not mandatory: the model selects `agent_type`, and full-history
forking has different default-role behavior ([child_config.rs lines 67–95](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/child_config.rs#L67-L95)).
V2-capable child model metadata enables the complete collaboration catalog,
including spawn ([spec_plan.rs lines 637–652](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/spec_plan.rs#L637-L652),
[lines 1242–1301](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/spec_plan.rs#L1242-L1301)).
The upstream residency test explicitly spawns worker-2 after evicting worker-1
([residency_tests.rs lines 22–68](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/residency_tests.rs#L22-L68)).

The absence of a role veto or explicit V2 depth field does **not** establish
absence of an enforced depth bound. Host follow-through challenged that inference:
the total cap2 becomes one non-root slot, shared across the tree through
`Arc<V2Residency>` ([control.rs lines 124–147](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control.rs#L124-L147)).
Spawn reserves before creation ([control/spawn.rs lines 616–654](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/spawn.rs#L616-L654));
an executing child cannot be evicted because unload requires terminal status,
no active turn and no pending mailbox ([residency.rs lines 233–239](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/residency.rs#L233-L239)).
Atomic pending-slot accounting prevents competing reservations from taking the
same slot. Child model/role overrides cannot increase the inherited cap.

This supports an effective depth-one invariant even when the child advertises
V2 collaboration: its own live residency exhausts the sole child slot. It remains
source-supported pending a native fixture with V2-capable child metadata. The
initial fixture's unsupported-tool result alone does not test this mechanism.
The worker is testing that case and positive sequential child replacement next.
Lifetime logical-child count remains unbounded by residency; all evicted children
still require custody/lifecycle accounting. Keep `OWNER_BACKGROUND_AUTHORITY_UNVERIFIED`
until this native evidence and service integration are reviewed. Do not substitute
role prompts or fixture-only metadata for enforcement.
