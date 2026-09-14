# Native capacity probe: overlapping roots, not installation admission

```sh
node scripts/test-codex-capacity.mjs
```

The probe needs the existing pinned `.local/codex-runtime` installation. It uses
one pristine **Codex 0.154.0** app-server, private HOME/CODEX_HOME/workspace,
scripted loopback Responses, and supported stdio RPC. No Worker rows, account auth,
external model provider, shell commands, connectors or production flags are used.

## Verified configuration and interfaces

The process starts with `app-server --strict-config --listen stdio://` and:

```toml
[features]
code_mode = false
multi_agent_v2 = true
[agents]
max_concurrent_threads_per_session = 1
max_depth = 3
```

The script checks `features list`, reads these exact values through `config/read`,
and confirms both `multi_agent` and `multi_agent_v2` enabled for the actual child
through `experimentalFeature/list`. V2 is **not the default** in this pinned
binary (`multi_agent_v2`: stable, default false). The legacy `agents.max_threads`
alias is not behaviorally tested here.

V2 advertises `collaboration.spawn_agent` with required `task_name` and `message`.
The fixture uses explicit `fork_turns: "all"`. Its receipt supplies
`task_name: "/root/child43"`, not V1's `agent_id`. Child work arrives as a native
`agent_message`; the fixture uses its synthetic marker without decrypting anything.
The child thread ID comes from actual turn notifications and is verified using
`thread/read.source.subAgent.thread_spawn.parent_thread_id` and `agent_path`.
No native database or private runtime implementation is inspected or patched.

## Actual observations

The final probe completes with **5 requests, 6 named assertions, 4 held HTTP
responses and 4 confirmed closures**:

1. Two independently started native roots both have outstanding held model
   responses in one process with configured limit 1. Their thread and turn IDs
   differ. Interrupting root A produces its exact interrupted event and closes A's
   connection while B remains active/open. B is then independently interrupted.
2. A third root spawns one V2 child. The root continuation and child's model request
   overlap while held. Exact source ancestry and both feature flags are checked.
3. The child and parent are interrupted by exact thread/turn IDs. All observed
   turns terminate and all held connections close **before** process shutdown.

This disproves treating that setting as a process-wide maximum of one active
root/inference turn. It also demonstrates a root plus child under value 1. It
does **not** establish maximum capacity, child permit residency, fairness, queues,
or a correct installation-wide scheduler. Worker independent-coordinator admission
remains a separate contract; see `CODEX_TWO_ROOTS.md`.

## Grandchild/waiting-permit behavior remains unverified

The actual child model request contains **no collaboration/spawn/wait tools**,
although V2 and multi-agent are enabled and the root continuation still advertises
spawn. Its catalog contains execution/input/image/goal tools and local-only web
search; none are called. Earlier bounded checks with `max_depth=2` and both
`fork_turns="none"` and `"all"` showed the same absence. Increasing the configured
depth to 3 did not supply the child tools.

The probe reports `childSpawnToolAvailable:false`,
`grandchildDispatch:"unsupported: child spawn tool absent"`. It does not send an
unadvertised tool call, manufacture a grandchild or call absence a queued/rejected
dispatch. A child waiting on a grandchild and whether it retains a permit are
therefore **not proved**. The cause of the child catalog omission is unresolved;
feature/config acceptance alone is insufficient to explain it.

Each RPC/wait and HTTP body is bounded. Fixture errors return HTTP 400 rather than
inviting native retries with HTTP 500. Cleanup confirms app-server exit, escalates
only that process if needed, closes the loopback server, and removes successful
private fixtures. Failure diagnostics remain private for inspection. Scripted
responses prove native mechanics, not model judgment, authenticated subscription
capacity, O06 completion, effects settlement or safe sleep.
