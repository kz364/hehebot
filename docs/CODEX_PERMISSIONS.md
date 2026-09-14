# Native filesystem permission diagnostic

Run `node scripts/test-codex-permissions.mjs` from the pinned extraction.
Exit0 means the bounded read/deny comparison passed; exit2 means a capability
gap; exit1 means a fixture/protocol/assertion failure. No production gate changes.

## Observed on pristine Codex 0.154.0

The final orb run passed with **20 scripted loopback model requests, 17 named
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
The follow-up fixture uses exact per-request synthetic approvals within the
owner's credential-free testing request; it does not change production authority.

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
Sprite actions, source-module edits, or production trust changes are involved.
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

This proves only the tested real shell reads and direct-child inheritance on this
host/build. It does not prove arbitrary native API/MCP-process isolation, alternate
path/symlink/hardlink attacks, every system read, adversarial-model safety, real
credential isolation, live Sprite enforcement, whole-task settlement or safe sleep.
Launch failure or missing workspace success remains a capability gap, not isolation.
