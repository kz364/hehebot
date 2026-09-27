# Restricted owner alpha: native capability boundary

## Decision

**Use the supported named profile for native filesystem/process operations and retain the trusted, immutable first-party MCP grant. No additional container around the trusted app-server or MCP server is justified by this source review. Do not describe the profile or denied callbacks as all-tool isolation.** The remaining non-shell restriction is explicit exclusion of unrelated provider/connector tool surfaces; they are outside the command sandbox. The imported baseline service lacked profile selection; the host subsequently reported implementing it as described below. This worker did not inspect that unpublished follow-on diff.

For the inspected paths, source shows no model-controlled arbitrary host-file reader that bypasses a restrictive profile: `view_image` and `apply_patch`, including patch verification before approval, use sandboxed filesystem helpers. Code mode's installed JavaScript API has no general filesystem/network API; nested calls retain the ordinary tool boundary. MCP resources and provider tools are different: their authority comes from their implementation, not `permissions.*`.

This resolves the **source prerequisite**, not live alpha admission, adversarial-model safety, kernel enforcement, native settlement, or production readiness. Keep existing verification/production flags false. No account, model, provider, deployment, or permissions experiment was performed for this document.

## Exact baselines and evidence level

- Hehebot: unpublished host main [487be774](https://github.com/kz364/hehebot/commit/487be774e3ba2dde4804a03e41732dae0f067754), imported from the supplied bundle, not `origin/main`. Bundle SHA-256: `f36359c08b692e123accd394394b416a59c31fddbc071eb81e273675e064a082`.
- Upstream: `openai/codex` annotated tag `rust-v0.154.0`, resolved using `git ls-remote` and a detached shallow source checkout to [6b9826e3](https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340). All upstream links below name that exact release tag; paths/quotes were checked against that checkout, not current main. No upstream code was imported into Hehebot or executed.
- Read local `runtime/agent-tools.mjs`, `runtime/codex-service.mjs`, `runtime/codex-adapter.mjs`, `runtime/codex-transport.mjs`, and `docs/CODEX_PERMISSIONS.md` before upstream inspection.
- **Existing behavioral evidence:** `CODEX_PERMISSIONS.md` records successful workspace shell reads and exact permission-denied outside reads for actual `exec_command` roots/direct V1 children, using synthetic files and narrowly approved initial commands. Its demonstrated custom profile is root-readable with an explicit denied subtree, **not a demonstrated minimal-read allowlist**. Those tests were not rerun here and establish no `view_image`, patch-preflight, code-mode, MCP-resource, or provider-tool behavior.
- **Subsequent host-reported evidence, not independently rerun here:** actual service `--restricted-background` passed six loopback requests with process default and every root selecting a content-digest-named profile, filesystem exactly `:minimal=read` plus absolute workspace read, network disabled, no shell executable allowance, all approvals refused, a fresh private home, config readback and pre-submit digest checks. Its only first-party MCP tools are `hehebot_list_routines` and `hehebot_read_skill`, backed by host-generated immutable grants. A separate worker demonstrated shell root/direct-child denials under a different minimal-plus-exact-ELF profile with explicit journal/token/home denies. That fixture policy is **not the service policy** and neither result proves built-in file-tool denial. This source conclusion applies to the reported service's remaining non-shell paths without requiring it to add the shell fixture's executable allowance.
- **New evidence:** static source wiring and supported controls only. A missing callback is not the filesystem read boundary; sandboxed helpers can read permitted files without requesting approval.

## Filesystem reads are not limited to exec_command

| Path | Exact pinned source and consequence |
|---|---|
| `view_image` | [Handler, lines 145–190](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/view_image.rs#L145-L190): `sandbox_context(/*additional_permissions*/ None)`, then metadata and `read_file(..., Some(&sandbox))`. It validates decoded image content before returning bytes. A model-controlled absolute path is not read directly by an unrestricted `std::fs` call. |
| `apply_patch` preflight | [Handler, lines 391–410](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/apply_patch.rs#L391-L410): `verify_apply_patch_args_with_mode(..., fs.as_ref(), Some(&sandbox))`. [Invocation, lines 235–280](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/apply-patch/src/invocation.rs#L235-L280) reads existing delete/update content before execution approval, but passes that context. Refusing file-change approval alone would not protect readable secrets; the profile must deny their reads. |
| Shell patch interception | [Handler, lines 505–530](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/apply_patch.rs#L505-L530) also passes `Some(&sandbox)` to `maybe_parse_apply_patch_verified_with_mode`. Treating shell-shaped patch calls specially does not omit the context. |
| Patch execution | [Runtime context, lines 87–112](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/runtimes/apply_patch.rs#L87-L112) uses effective attempt permissions; [execution, lines 168–198](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/runtimes/apply_patch.rs#L168-L198) passes the resulting context to the filesystem implementation. Refused escalation must remain refused; an unsandboxed approved attempt is a different policy. |
| Ordinary file search/read | No standalone core `read_file`, `grep_files`, or `list_dir` registration appears in [the core tool plan](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L975-L1282). Shell `cat`/`rg`/`find` use the command sandbox. `tool_search` searches registered tool descriptions, not arbitrary host files. Client app-server file RPCs are not model tool registrations. The separate `notes.read_file` extension is addressed below. |

The environment constructs its filesystem context from the selected effective profile, cwd and workspace roots: [session/turn_context.rs, lines 120–150](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/turn_context.rs#L120-L150). The decisive implementation chain is:

1. [file-system/src/lib.rs, lines 395–403](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/file-system/src/lib.rs#L395-L403): `should_run_in_sandbox()` selects restricted profiles without full-disk write access; an unconvertible foreign context also selects sandboxing.
2. [exec-server/local_file_system.rs, lines 95–107](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/exec-server/src/local_file_system.rs#L95-L107): `Ok((self.sandboxed()?, sandbox))`, not unrestricted fallback. Missing sandbox runtime paths return an error.
3. [sandboxed_file_system.rs, lines 119–142](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/exec-server/src/sandboxed_file_system.rs#L119-L142): read requests run through `run_sandboxed`/`FsHelperRequest::ReadFile`.
4. [fs_sandbox.rs, lines 90–150](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/exec-server/src/fs_sandbox.rs#L90-L150): materializes profile roots, forces helper networking restricted, selects `SandboxablePreference::Require`, and errors with `filesystem sandbox cannot be enforced on this executor` rather than silently running without a sandbox.

**Helper exception to a literal allowlist:** [fs_sandbox.rs, lines 216–253](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/exec-server/src/fs_sandbox.rs#L216-L253) adds `:minimal` and the exact native helper executable paths when needed. These are implementation/runtime reads, not a grant to the entire credential home. Keep secrets out of system/runtime readable locations and helper executables; do not claim the effective read set is only the workspace. This review did not test alternate paths, links, `/proc`, or target Sprite enforcement.

`view_image` can be removed with `features.view_image = false`; [registration](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1269-L1281) checks the feature. That is optional surface reduction, **not a required fix for an identified bypass**. `apply_patch` registration depends on environment/model metadata [lines 1255–1258](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1255-L1258); `features.apply_patch_freeform` is an [ignored legacy key](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/features/src/lib.rs#L585-L597), not a supported disable switch.

## Code mode preserves tool authority, but false feature flags are not an absolute off switch

[tools/mod.rs, lines 68–90](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/mod.rs#L68-L90) uses `model_info.tool_mode.unwrap_or_else(...)`: **model metadata takes precedence over `features.code_mode` and `features.code_mode_only`**. Do not certify code mode absent from those two false flags alone. Several entries in the pinned bundled model catalog specify `code_mode_only`.

If selected, the source boundary is a V8 API, not the command OS sandbox:

- [globals.rs, lines 15–49](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/code-mode-runtime/src/runtime/globals.rs#L15-L49) installs tool callbacks, output/timer helpers and `store`/`load`; no Node filesystem, process or fetch interface is installed.
- [module_loader.rs, lines 222–235](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/code-mode-runtime/src/runtime/module_loader.rs#L222-L235) rejects imports with `Unsupported import in exec`; this is not unrestricted Node/Deno execution.
- [callbacks.rs, lines 205–267](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/code-mode-runtime/src/runtime/callbacks.rs#L205-L267) implements `store`/`load` against `state.stored_values`, not model-selected disk paths. [Image normalization](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/code-mode-runtime/src/runtime/value.rs#L65-L78) rejects HTTP(S) and non-data URLs; [audio](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/code-mode-runtime/src/runtime/value.rs#L209-L218) likewise requires a data URL.
- [Nested dispatch](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/code_mode/mod.rs#L345-L400) uses `tool_runtime.handle_tool_call_with_source`; [delegate construction](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/code_mode/delegate.rs#L100-L114) retains the step context. A nested file tool still receives its sandbox context; an MCP tool still uses its server grant.

No concrete generic file/network escape was found in that installed API. This is not an engine-exploit audit or an executed code-mode contract. For a direct-tools-only alpha, keep both flags false **and select/check direct-or-unspecified model tool-mode metadata**; if metadata forces code mode, do not claim it was disabled. Enabling code mode does not itself require widening filesystem, network, or MCP grants.

## MCP and dynamic calls are intentionally outside the command sandbox

[Dynamic handlers](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/dynamic.rs#L119-L148) forward model arguments to the host; no native filesystem/network policy limits the callback's effects. Supply no dynamic tools for this service. Existing transport support for `item/tool/call` is not itself a model-visible app-server RPC proxy.

MCP invocation likewise uses the trusted configured process/client. **The local Hehebot server is not a generic privileged executor:** `createAgentToolsHandler` snapshots the grant, builds validators only for `allowedTools`, rejects non-`tools/call` methods except initialize/ping/list, uses strict argument schemas, and supplies identity/run/attempt/provenance from configuration. Model arguments cannot replace the configured origin, token path, grant path, command, environment, or run identity. Calls have fixed control-client routes; there is no arbitrary URL/file/code parameter interpreted as host authority. Worker authorization of the resulting commands remains a separate required trust boundary, not established by this source review.

**Concrete bypass candidate checked:** a model can call `read_mcp_resource(server="hehebot", uri="file:///host/secret")`. Core [registers resource tools whenever an MCP server exists](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1128-L1134), and [forwards the URI to `resources/read`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/mcp_resource/read_mcp_resource.rs#L73-L94), without the command filesystem sandbox. **It does not open that URI locally.** Hehebot advertises tools only and rejects `resources/read`/resource listing with method-not-found, so this path cannot read its grant or token. Preserve that contract. Adding a generic resource server would change this conclusion even with an unchanged native profile.

Set `mcp_servers.hehebot.enabled_tools` to the exact admitted subset as defense in depth. [codex-mcp/src/tools.rs, lines 70–103](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/codex-mcp/src/tools.rs#L70-L103) filters tools before registration. The existing per-tool `approval_mode = "approve"` does not grant an unlisted tool, but it is not a replacement for an allowlist. Resource methods are not covered by `enabled_tools`; the server rejection above is essential.

Do not rely on a hidden/deferred tool schema as denial. [registry dispatch, lines 516–539](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/registry.rs#L516-L539) resolves the supplied name in the runtime registry; absent registration produces unsupported-tool. `tool_search` or code-mode exposure cannot enlarge Hehebot's server-side validator set, but schema hiding alone does not remove an existing runtime.

## Provider tools need separate explicit exclusion

- **Web search:** `network.enabled = false` does not constrain provider-side search. [Hosted spec](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/hosted_spec.rs#L14-L20) sets cached `external_web_access=false`, live/indexed true, and emits nothing for Disabled. Cached search is not proof of arbitrary live HTTP effects, but is still a provider operation outside the sandbox. Top-level `web_search = "disabled"` removes the hosted spec and [skips standalone `web.run` registration](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1430-L1440). A false standalone feature alone is insufficient because [Responses Lite can select it](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1038-L1046).
- **Hosted apps:** a fresh local home alone is insufficient once Codex authenticates. [ext/mcp/src/lib.rs, lines 34–47](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/mcp/src/lib.rs#L34-L47) contributes the hosted apps MCP server unless `features.apps` is false. This can add capabilities beyond the sole local grant, subject to the account/catalog. Set it false; absence of an installed local connector is not proof of absence of hosted tools. (v2 exception: a thread whose run holds `GOOGLE_POLICY` gets `apps` on for Gmail/Calendar only, with every write fenced; see [GOOGLE_APPS.md](GOOGLE_APPS.md).)
- **Plugins/tool suggestions:** keep plugins and tool suggestions off and install/select no additional MCP/extension plugins. [Suggestion eligibility](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L633-L638) depends on Apps/Plugins/ToolSuggest. Do not use plugin installation to fill an alpha capability gap.
- **Image generation:** an independent provider tool, not generic permission-profile networking. `features.image_generation = false` makes [availability false](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L699-L708), and [registration skips it](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L1441-L1445). No alpha requirement here authorizes it.
- **History/notes search/read:** [extension tools](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/history-notes/src/tools.rs#L25-L28) describe virtual notes, not host paths. The implementation [posts to fixed provider endpoints with host-assigned session/agent context](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/history-notes/src/backend.rs#L29-L92); it is not a host credential-file reader or arbitrary destination URL. It is outside the command sandbox. Leave history-notes/token-budget mode unselected for this bounded alpha; [extension activation](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/history-notes/src/extension.rs#L45-L63) checks effective `use_history_notes_extension`. Do not infer all provider-side behavior is network-blocked.

These are concrete independent authority surfaces, not evidence that the first-party MCP implementation must be sandboxed merely because it has credentials.

## Refusal and child inheritance

`request_permissions` normalizes requested paths and [waits for a host response](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/request_permissions.rs#L84-L127); it cannot authorize itself. On the current transport's JSON-RPC error, [app-server returns an empty permissions grant](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/bespoke_event_handling.rs#L1968-L1991). [File-change callback errors map to denial](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/bespoke_event_handling.rs#L2043-L2062), as do [command callback errors](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/bespoke_event_handling.rs#L2133-L2157). Keep approvals host-refused, no session allow/rules amendment/unsandboxed retry. Disable `request_permissions_tool` and `exec_permission_approvals` for the bounded alpha; refusal remains necessary if any approval request arrives. `requestUserInput` answers must never become approvals.

Native spawn [clones config](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/multi_agents_common.rs#L195-L219) and [copies live approval policy and permission-profile snapshot](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/multi_agents_common.rs#L234-L265). V1 spawn [reapplies these after role selection](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs#L94-L110). This agrees with existing direct-child shell evidence; it does not establish recursive settlement or child-specific MCP grants. An inherited MCP configuration still represents the parent's immutable admitted grant, not fresh per-child authorization.

For a root-only restricted alpha, use **`[agents] enabled = false` and `features.multi_agent_v2 = false`**, plus `features.multi_agent = false`. The [config precedence](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs#L1544-L1561) otherwise lets V2 override agents-disabled; [the TOML source is `agents.enabled`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs#L3791-L3795). This is alpha scope/settlement restriction, not a filesystem escape fix. Do not use unsupported top-level `agents_enabled` or confuse `collab` with the canonical `multi_agent` feature key.

## Smallest service decision to carry forward

1. **Preserve the host-reported content-digest profile selection**, including each per-run adapter, using experimental API initialization and `thread/start.permissions`, never combined with `sandbox`. [Protocol contract](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L94-L98). Retain config readback and pre-submit digest checks. Do not broaden the actual `:minimal` plus workspace service profile to match the separately owned shell diagnostic; filesystem helpers supply their own runtime access as documented above.
2. Keep workspace/runtime-required reads only, deny credential/grant/journal/Codex-auth state reads to model tools, forbid model writes to service code/config/grants, and disable sandbox networking. Trusted app-server/MCP access to those files remains intentional. Keep all privileged input paths and code host-owned, no inherited exec allow rules, no externally managed/full-access sandbox override, no additional executor or plugin. The model may supply tool arguments but cannot rewrite the grant or select a new MCP process/profile.
3. **Remaining authority restriction:** disable web search, hosted apps, plugins and image generation; leave provider history/notes unselected, supply no dynamic tools or additional MCP servers, and retain local resource rejection. Set the sole server's `enabled_tools` to `hehebot_list_routines` and `hehebot_read_skill`, matching the reported immutable alpha grant. No generic file or network escape was found in those two local methods. The other settings below are optional-surface/root-only scope choices, not additional containment fixes required by a demonstrated bypass. Do not add a direct-only-model or root-only restriction solely to compensate for an alleged filesystem escape: none was found.

```toml
# Pass approvalPolicy:"untrusted" through thread/start, not this TOML file.
web_search = "disabled"

[agents]
enabled = false

[features]
multi_agent = false
multi_agent_v2 = false
apps = false
plugins = false
tool_suggest = false
image_generation = false
standalone_web_search = false
request_permissions_tool = false
exec_permission_approvals = false
code_mode = false
code_mode_only = false
token_budget = false

# Retain the existing fixed command/args/env with this alpha subset.
[mcp_servers.hehebot]
enabled_tools = ["hehebot_list_routines", "hehebot_read_skill"]
```

The baseline implements six possible tools; do not enable its four mutation tools for the reported read-only alpha. `view_image = false` is optional. Patch remains profile-governed. Model metadata can select code mode and context behavior; if the host chooses a direct-only alpha, check its effective selected model mode rather than trust false feature flags or a catalog screenshot. Nothing here authorizes an authenticated model probe.

**Disposition:** source supports proceeding with that bounded service configuration and the existing first-party grant boundary. No demonstrated native built-in credential-reader bypass requires a replacement harness or broader containment project. Until independently exercised, built-in denial remains source-supported/unverified behavior; shell positive-deny evidence must stay labeled shell-only.
