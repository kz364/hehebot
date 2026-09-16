# Native filesystem permission diagnostic

Run `node scripts/test-codex-permissions.mjs` from the pinned extraction.
Exit0 means the bounded read/deny comparison passed; exit2 means a capability
gap; exit1 means a fixture/protocol/assertion failure. No production gate changes.

## Minimal reads: shell launch gap and exact executable addition

The credential-free restricted-alpha prerequisite has two explicit variants;
neither replaces the original no-argument comparison:

```sh
bash scripts/setup-codex.sh
node --check scripts/test-codex-permissions.mjs
node scripts/test-codex-permissions.mjs                  # exit0, original comparison
node scripts/test-codex-permissions.mjs --minimal        # exit2, launch gap on this orb
node scripts/test-codex-permissions.mjs --minimal-native # exit0, exact ELF read added
```

On pristine Linux x64 Codex 0.154.0, **`:minimal` plus explicit workspace read is
not sufficient to launch the npm-installed native sandbox helper**. Strict
configuration and experimental initialize succeed, but every custom root/child
shell attempt returns exit1 with:

```text
bwrap: execvp /home/user/workspace/repo/.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex: No such file or directory
```

`--minimal` preserves this result: `filesystemIsolationProved:false`,
`childInheritanceProved:false`, `status:"capability-gap"`. The baseline root and
child read all four paths successfully, but neither custom task has a successful
workspace control. **Launch failure is not filesystem-denial evidence.**

`--minimal-native` adds read access to that **single actual native ELF**, not the
Node launcher, installation directory, repository, home, `/tmp`, or `:root`.
No other explicit system-root additions were needed on this orb. This addition
is a fixture alternative for host review, not a change to service policy.
The selected profile is the following template (the fixture substitutes exact
absolute disposable paths and prints the exact bytes in `selectedProfileToml`):

```toml
[permissions.isolated.filesystem]
":minimal" = "read"
"/home/user/workspace/repo/.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex" = "read"
"/absolute/disposable/state/workspace" = "read"
"/absolute/disposable/state/journal" = "deny"
"/absolute/disposable/state/runtime-token" = "deny"
"/absolute/disposable/state/codex-home" = "deny"
[permissions.isolated.network]
enabled = false
```

`--minimal` omits only the ELF entry. Workspace **read**, rather than write,
matches the host's updated read-only restricted-alpha candidate; no workspace
writes are attempted or claimed. The baseline/default remains `:root = "read"`
for the comparison only. Both variants use `permissions:"isolated"` exclusively
for the custom root, `approvalPolicy:"untrusted"`, `--strict-config`, and
`experimentalApi:true`. `config/read` checks every filesystem entry exactly
(including native's null `glob_scan_max_depth` metadata) and network disabled.

The service-shaped layout places `workspace`, `journal`, `runtime-token`, and
`codex-home` under one private synthetic `state` directory. The grant filename
matches the service journal's `grant-<attempt>.json` convention; its contents and
the token are random synthetic canaries, not real grants or credentials. One
workspace symlink points to that same outside grant. This tests topology, not
access to any deployed service's actual credential files.

| Variant / tasks | Workspace file | Sibling grant | Sibling token | Workspace symlink → grant |
|---|---|---|---|---|
| Baseline root and direct child | Exact contents, exit0 | Exact contents, exit0 | Exact contents, exit0 | Exact contents, exit0 |
| Minimal root and direct child | Launch failure | Launch failure | Launch failure | Launch failure |
| Minimal + exact ELF root and direct child | Exact contents, exit0 | Permission denied, exit1 | Permission denied, exit1 | Permission denied, exit1 |

The passing ELF variant makes **24 scripted loopback requests**, records **26
assertions**, accepts **16 exact single-read commands**, and declines both real
suffix commands. Actual shell outputs are retained in `shellOutputs`, with
canary values replaced only after comparison. The denied synthetic home produces
`/bin/bash: <home>/.bashrc: Permission denied` even with `login:false`; the positive
control requires exit0 and the entire exact canary payload, optionally preceded
by only this exact warning. It does not mistake that warning for a negative
grant/token result. Each negative requires `cat: <exact probe path>: Permission
denied` and exit1. Child parent identity is verified by `thread/read`; all four
turns complete, the process stops, and disposable files are removed.

The original no-argument mode still passes with 20 requests, 25 assertions,
12 exact approvals and two suffix declines. Both minimal variants retain bounded
requests/waits, exact approvals, no escalation, no installed allow-prefix rules,
and unchanged native executable hashes. Their JSON also records full
`configToml`, so `jq -j .configToml LOG > config.toml` reproduces the tested bytes
(including the now-expired disposable paths and loopback port).

This proves the bounded shell read/deny behavior **only with the exact ELF
addition**. It does not prove the host's unaugmented profile has usable shell
access, sandboxing of the app-server or first-party MCP subprocesses, real
credential protection, arbitrary symlink/hardlink attacks, write policy, network
denial by a live probe, Sprite behavior, or restricted-alpha readiness. Native
home denial is configured but no home canary is tested. No accounts, auth,
real-model calls, providers, shared verifier, adapter, service or gates changed.
A chat/read-MCP service may intentionally leave shell unavailable; that service
decision and its independent read-MCP/background verification belong to the host.

## Observed on pristine Codex 0.154.0

The adapter-backed orb run passed with **20 scripted loopback model requests, 25 named
assertions, 12 exact initial command approvals, and two explicit suffix-command
declines**. Both roots and their actual native children attempted real
`exec_command` reads of three distinct synthetic canaries:

| Native task | Shared workspace file | Outside grant file | Outside credential file |
|---|---|---|---|
| Baseline read-only root | Exact contents, exit0 | Exact contents, exit0 | Exact contents, exit0 |
| Baseline child | Exact contents, exit0 | Exact contents, exit0 | Exact contents, exit0 |
| Custom-profile root | Exact contents, exit0 | Permission denied, exit1 | Permission denied, exit1 |
| Custom-profile child | Exact contents, exit0 | Permission denied, exit1 | Permission denied, exit1 |

These are actual shell outputs, not model claims or tool-catalog inference.
The native output for each custom outside read includes
`Process exited with code 1` and `cat: <exact disposable path>: Permission denied`.
Workspace success is required before interpreting outside denial as enforcement.
An additional real `cat workspacePath grantPath` call in each root is explicitly
declined, confirming initial approvals did not authorize appended argv.

Child identities are verified through `thread/read` against the exact parent;
all four turns complete before shutdown. Crucially, the process-wide default
profile is **baseline**, not isolated. Thus the custom child's denial is not an
accidental consequence of a default isolated profile. The custom root's supported
profile selection propagates to the child in this bounded V1 spawn case.

## Host-selected adapter boundary

Both native roots now start through `CodexAdapter.submit` and real private
`FileJournal` files, not direct fixture calls to thread/turn start. The fixture
checks durable intent before thread/start, exact persisted thread before
turn/start, and native thread/turn receipts after reopening the journal. Reopened
duplicate submissions return the original receipt without RPC; adding/removing
the profile rejects with `IDEMPOTENCY_CONFLICT`. Sleep and production verification
remain false. This exercises submission persistence, not a complete observation
journal, crash recovery admission, or task settlement.

The adapter accepts optional constructor-only `permissionsProfile`, restricted
to 1–128 ASCII letters, digits, underscores or hyphens. It stores the name in a
private field and rejects malformed configuration; submission cannot select a
profile, sandbox or config. A profile sends native `permissions` instead of
`sandbox: "read-only"`; it does not change `approvalPolicy: "untrusted"`.
The host must configure the named profile and explicitly initialize transport
with experimental API capability. No service default activates this feature.

The selected profile name participates in the durable fingerprint. Its absence
preserves the prior fingerprint exactly for empty, dynamic-tool-only, MCP-only,
and combined configuration. Unit tests verify those four old hash formats,
reopened receipts, profile changes/removal, uncertain receipts, validation bounds,
model-field rejection, constructor snapshotting, and unchanged gates.
`node --test tests/runtime-codex-adapter.mjs` passes14 tests. The integrated
`scripts/verify-codex.sh` also runs this native probe, the broader runtime suite
and typecheck; report its current totals rather than the older extraction count.

The fingerprint binds the **name**, not mutable TOML profile contents. Stable,
host-controlled profile definitions remain a deployment/recovery prerequisite;
this unit does not detect changing a definition while reusing its name.

## Exact supported configuration

```toml
default_permissions = "baseline"
[permissions.baseline.filesystem]
":root" = "read"
[permissions.baseline.network]
enabled = false
[permissions.isolated.filesystem]
":root" = "read"
":workspace_roots" = "read"
"/absolute/disposable/host-only" = "deny"
[permissions.isolated.network]
enabled = false
```

The actual deny target is a new private directory containing only the two canary
files. Root read allows required runtime/system reads; only that disposable
subtree is denied. Baseline `thread/start` sends `sandbox: "read-only"`; custom
start sends `permissions: "isolated"` instead, never both. `--strict-config`,
`experimentalApi: true`, and `config/read` verify supported profile configuration.
`multi_agent` is enabled and the advertised V1 `spawn_agent` namespace is used;
this is not a V2/grandchild test.

Pinned upstream references:

- [Profile structures](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/config/src/permissions_toml.rs#L111-L119)
  and [filesystem mapping](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/config/src/permissions_toml.rs#L223-L244).
- [Experimental thread/start permissions](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L93-L98)
  is a profile-name string incompatible with `sandbox`.
- [Linux sandbox implementation](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/linux-sandbox/README.md#L24-L63)
  uses bubblewrap for restricted-read carve-outs. No legacy Landlock substitution,
  privileged launch, installed-native modification, or sandbox bypass is used.

## Exact approval, not an unsafe prefix allow

The pinned `execpolicy check --rules candidate.rules -- cat PATH` is run offline
against all three synthetic paths. They match `prefix_rule(pattern=["cat",PATH],
decision="allow")`, as does `cat PATH OTHER_PATH`. A different first path has no
matching rule. **No candidate rule is installed in CODEX_HOME/rules.**
[PrefixPattern](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/execpolicy/src/rule.rs#L45-L59)
checks only a prefix, not equal argv length. `match`/`not_match` are load-time tests,
not exclusions; this tag has no exact-full-argv rule.

The initial no-approval diagnostic correctly exited2: `untrusted` prompts for
unmatched commands including `cat` ([decision logic](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/exec_policy.rs#L809-L819)).
Exact synthetic per-request approvals fall within the owner's broader
credential-free implementation/testing authority, not a new direct owner message
or a production trust expansion.

The final fixture keeps `approvalPolicy: "untrusted"`, sends only exact `cat`
commands with `/bin/bash`, `login:false`, and `sandbox_permissions:"use_default"`,
and compares the entire rendered native request, e.g.
`/bin/bash -c 'cat /absolute/disposable/workspace/shared.txt'`. It checks local
environment, exact cwd, known item/call ID, active turn ID and expected root or
verified direct child. It accepts each allowed item at most once. Suffix, wrong
command/path/identity/cwd, extra permissions, network approval, or a non-null
retry reason is denied. Predicate regressions exercise asymmetric mismatches;
real suffix calls also exercise the denial over app-server RPC.

Only plain `decision:"accept"` is returned, never session approval or policy
amendment. Native may propose an exec-policy amendment in the initial request;
the fixture does not apply that proposal. It explicitly declines all other
approvals, including sandbox-failure escalation.

This initial approval retains the sandbox:
[orchestrator](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/orchestrator.rs#L141-L317)
approves before selecting the configured first-attempt sandbox;
[first-attempt bypass](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/sandboxing.rs#L238-L266)
requires escalated permissions or an explicit bypass decision, neither used here.
[Plain accept](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/bespoke_event_handling.rs#L1963-L1978)
maps to Approved, not a changed sandbox policy. A
[sandbox-failure retry](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/orchestrator.rs#L327-L508)
carries a reason and may request unsandboxed execution; the fixture never approves
it. None occurred in the passing run.

## Integrity, cleanup, and limits

All directories are private0700, files0600, and HOME/CODEX_HOME are disposable.
Only PATH/LANG and these homes are inherited. Model responses are scripted over
loopback; no credentials, accounts, external model requests, Worker admission,
Sprite actions, native patches, or production trust changes are involved.
RPC waits, response bodies and request counts are bounded. Native turns finish,
the native process stops, HTTP connections close and private files are removed.
Printed evidence omits canary contents and arbitrary native transcripts.

Before/after SHA-256 values match for both entrypoint and actual native ELF:

- Node entrypoint: `61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70`
- Linux x64 native ELF: `3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022`

Earlier development failures included missing mandatory `default_permissions`,
incorrect assumptions about child source notification and rendered approval
command, and rejecting local environment/proposed-but-unapplied amendment fields.
They failed closed and are not counted as passing enforcement evidence.

The original comparison proves only the tested real shell reads and direct-child
inheritance on this host/build. The minimal ELF variant additionally tests one
workspace-to-grant symlink, not arbitrary native API/MCP-process isolation,
alternate path/symlink/hardlink attacks, every system read, adversarial-model safety, real
credential isolation, live Sprite enforcement, whole-task settlement or safe sleep.
Launch failure or missing workspace success remains a capability gap, not isolation.
