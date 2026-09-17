# Bounded owner-alpha native prerequisite

This is credential-free evidence for pristine Codex app-server **0.154.0**,
not an operational alpha or authorization to run one. The first owner alpha is
root-only: one explicitly chosen persona, one to three admitted root requests,
at most five minutes, no provider tools, and only the separately authorized
read-only MCP subset if supplied. Backend admission, service assembly and owner
authorization are separate contracts. No execution/native-verification gate changes.

## Reproduce the isolated native contract

```sh
bash scripts/setup-codex.sh
node scripts/test-codex-owner-alpha.mjs
node scripts/test-codex-owner-alpha.mjs --profile-overrides
node scripts/test-codex-owner-alpha.mjs --text-only
```

### Text-only candidate is a separate local prerequisite

`--text-only` keeps the profile-override test and adds a supported static
`model_catalog_json` with `tool_mode:"direct"` and no experimental tools, explicit
`turn/start.environments:[]`, no MCP/dynamic tools, and disabled goals/hooks/image/
sleep features plus `tools.experimental_request_user_input.enabled:false` and
`tools.update_plan.enabled:false`. These settings follow the pinned upstream
[temporary structured request](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/temporary_structured_request.rs)
and [turn interface](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).
Empty environments alone leaves utility/extension tools; feature flags alone do
not override model-selected code mode. The fixture uses a synthetic model, not
fabricated live model eligibility or a Codex-owned cache/database modification.

Every scripted provider request must contain exactly `tools:[]`. Seventeen
injected spawn, shell, patch, image, goal, code-mode, user-input, plan, MCP-resource
and clock calls must each return the exact unsupported-call error. Two exact root
outputs, one native thread, no background terminals, unchanged config/catalog
bytes and three loopback requests are checked. Native config/read omits the two
extension tool settings; their effect is checked through actual catalog/dispatch
behavior, not an invented readback field. The report deliberately retains
`completionEligible:false`: this is not a settlement builder, an exhaustive
extension audit, live ChatGPT behavior or permission to close historical tasks.
Runtime admission, receipt construction, output identity, coverage, Worker gates,
observation-loss handling and safe session lifecycle still need separate work.

The script imports the existing transport (including its sanitized environment
and default-denied callbacks). It creates a private disposable home under
`.local/owner-alpha-native-*`, a workspace, and one loopback scripted provider.
It neither reads existing auth nor performs login, account/model discovery,
authenticated inference, provider actions, file/network permission probes, or
MCP calls. Complete native frames, events, RPC results, request bodies and stderr
stay in mode-0600 `raw.json` under the private directory; stdout and `report.json`
contain only the bounded report. The disposable Codex home is removed afterward.

Exact native config, confirmed by `config/read`:

```toml
web_search = "disabled"
default_permissions = "owner-alpha"
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
token_budget = false
request_permissions_tool = false
exec_permission_approvals = false
code_mode = false
code_mode_only = false
[permissions.owner-alpha.filesystem]
":minimal" = "read"
"<workspace>" = "read"
"<private-codex-home>" = "deny"
"<journal>" = "deny"
"<token-path>" = "deny"
[permissions.owner-alpha.network]
enabled = false
```

No ELF shell allowance, dynamic tools, MCP servers, or extra provider tools are
installed. The fixture provider is `fixture-model`, Responses over loopback,
`requires_openai_auth=false`, with request/stream retries zero. The profile is
selected using experimental initialization and `thread/start.permissions`, never
combined with `sandbox`. The service's content-digest profile naming remains
unchanged; this standalone fixture uses a fixed name in a fresh private home.

### CLI profile overrides preserve the original config

The optional `--profile-overrides` mode omits both `default_permissions` and the
entire permission profile from the original fixture config. Instead, it launches
the pristine binary with these supported argv pairs (paths shown as placeholders):

```sh
-c 'permissions.owner-alpha={filesystem={":minimal"="read","<workspace>"="read","<private-codex-home>"="deny","<journal>"="deny","<token-path>"="deny"},network={enabled=false}}'
-c 'default_permissions="owner-alpha"'
```

The integrated fixture uses `spawnCodex`'s bounded inline-TOML encoder, sanitized
environment and default-denied callbacks, exercising the same override path as
the service. Root-only/provider feature
settings remain in the synthetic original config in both fixture modes.

Both modes assert identical native `config/read`: `default_permissions` is
`owner-alpha`; filesystem is exactly `glob_scan_max_depth:null`, `:minimal:read`,
workspace read, and home/journal/token deny; network `enabled:false`. All root-only
and disabled-surface assertions, RPC `approvalPolicy:"untrusted"`, exact failed
spawn outputs and successful root outputs run unchanged in both modes.

The test compares original config **bytes**, not only parsed values, after native
shutdown and before deleting its disposable home. Reports include equal
`originalConfigSha256`/`finalConfigSha256`, `originalConfigUnchanged:true`, and in
override mode `originalProfileAbsent:true`. Native profile readback is reported
with only private paths redacted. Digests vary by fixture port/path; compare
before/after within the same run, not across modes. Any change fails the fixture.

This proves a profile/default can be supplied without rewriting `config.toml`;
it does not prove zero native state writes, isolation from preexisting profiles,
or safe reuse of an arbitrary existing home. No existing owner home or account
is accessed. The authorization, effective-config review and refresh-ownership
requirements below still apply.

**Approval distinction:** top-level TOML `approval_policy="untrusted"` was rejected
at startup with `approval_policy = "untrusted" is no longer supported; remove this
setting`. The final fixture omits that TOML key (`config/read` reports null) and
passes **RPC `thread/start.approvalPolicy:"untrusted"`**, which succeeds and is
returned as `untrusted`. The TOML failure does not invalidate the existing service
RPC shape. `never` is not required here, and would not mean all sandboxed execution
is denied. No approval callback gains authority by arriving.

## Observed behavior and exact assertions

One Travel root thread executes two turns and exactly three scripted HTTP requests
(well below five minutes; a four-minute watchdog also terminates the fixture).
After inspecting each actual tool catalog, the first scripted response deliberately
submits all three supported naming forms, even though none is advertised:

| Submitted namespace/name | Exact subsequent function-call output |
|---|---|
| `multi_agent_v1` / `spawn_agent` | `unsupported call: multi_agent_v1spawn_agent` |
| `collaboration` / `spawn_agent` | `unsupported call: collaborationspawn_agent` |
| no namespace / `spawn_agent` | `unsupported call: spawn_agent` |

The missing separator is pinned upstream [ToolName Display](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/protocol/src/tool_name.rs#L54-L61),
not a relaxed error assertion. The [registry's missing-runtime branch](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/registry.rs#L516-L539)
returns these errors to the model. [V1 namespace/spec](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)
and [V2 default namespace](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs#L239)
establish the names independently of the disabled catalog.

Both turns complete, with persisted exact outputs `ROOT_ONLY_DENIALS_VISIBLE_19`
and `ROOT_COMPLETION_OK_43`. Assertions require one thread-start event, two root
turn-start events, no collaboration item, only the root in loaded/listed threads,
no background terminals, and exactly three model requests. An unexpected child
request cannot consume an extra scripted response successfully. Unknown dispatch,
unsupported root-only config, missing rejection or extra inference fails with
`status:capability_gap` and a nonzero exit; absence of schema alone is not success.

The observed direct-tool catalog is `exec_command`, `write_stdin`,
`request_user_input`, `view_image`, `get_goal`, `create_goal`, `update_goal`.
Their presence is not permission or evidence of execution. No shell/file/network
probe or claim of general recursive settlement is added here. MCP is absent in
this fixture; if supplied by the service, its immutable grant and native
`enabled_tools` must both permit only `hehebot_list_routines` and
`hehebot_read_skill`, retaining resource-method rejection.

Coverage is limited to the scripted provider's fallback model metadata. False
code-mode flags do **not** override model metadata. This test does not execute
code mode or establish the catalog of an owner-authenticated model. See
[the source-reviewed capability boundary](ALPHA_NATIVE_CAPABILITY_BOUNDARY.md).
`productionAdmission`, `nativeVerified`, and `modelJudgmentVerified` remain false.

## Future owner-authorized auth and discovery, not executed here

**Yes: a supported existing owner-authorized `CODEX_HOME` may be used in place,
without copying credentials.** [Pinned home resolution](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs#L4772-L4781)
accepts an existing directory. Keep host journal/state and `thread/start.cwd`
workspace separate from that directory, and deny model access to all auth/host
paths. This does not isolate native Codex history/config: those remain associated
with the selected home. Optional `sqlite_home` is not a general auth-only home
split. The integrated local alpha service accepts explicit `nativeHome` and uses
CLI overrides without rewriting the original config; see [session setup](CODEX_SERVICE.md#explicit-supervised-local-session).
This fixture does not exercise an existing authenticated home.

Reuse requires the same owner's explicit authorization for this process/account,
the original credential-store mode and accessible OS keyring if applicable, and
one coordinated managed refresh owner. Do not copy `auth.json`, export tokens,
change store modes to extract credentials, use `chatgptAuthTokens`, or point at
another application's/account's home. Stop or coordinate other consumers before
claiming exclusive runtime ownership. Review effective supported config/MCP/plugin
surfaces and enforce alpha overrides; an existing home is not a blank configuration.

The following procedure is a future owner action, not permission granted by this
fixture. In a private terminal on the authorized runtime, use the selected home:

```sh
CODEX_HOME=/absolute/owner-authorized-home /absolute/codex login status
# Only if login is needed and the owner authorizes it:
CODEX_HOME=/absolute/owner-authorized-home /absolute/codex \
  -c forced_login_method='"chatgpt"' login --device-auth
```

Preserve its credential-store configuration. Complete the supported device flow
privately. A new environment without authorized in-place access needs its own
login; never transfer a cache. Applying `forced_login_method` to incompatible
existing credentials can log the user out, so it is not a harmless inspection.
See [supported authentication/storage documentation](https://developers.openai.com/codex/auth/).

For supported app-server discovery on that home: `initialize` with clientInfo and
`capabilities:{experimentalApi:true}`, then `initialized`, then
`account/read {"refreshToken":false}`. The result is
`{account,requiresOpenaiAuth}`; do not log personal account fields. If login is
authorized/needed, `account/login/start {"type":"chatgptDeviceCode"}` returns
`loginId`, `verificationUrl`, `userCode`; complete privately and wait for
`account/login/completed` with success, then re-read the account. Browser login
`{"type":"chatgpt"}` is also supported. [Pinned login union](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/LoginAccountParams.ts)
and [account read parameters](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/GetAccountParams.ts)
define these interfaces.

Then `model/list {"cursor":null,"limit":100,"includeHidden":false}`, following
`nextCursor` until null. This is non-inference discovery, **not guaranteed offline
or free of native cache writes**: [pinned model discovery](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/models.rs#L14-L23)
uses `OnlineIfUncached`, so it requires authorization for account/provider access.
`account/read refreshToken:false` requests no proactive refresh; it is not a promise
that a later network operation will never refresh credentials. No `thread/start`
or `turn/start` is needed for discovery. Catalog presence is not model eligibility,
quota, inference, or subscription-hosting approval. The [public Model shape](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/Model.ts)
exposes `multiAgentVersion` but no `tool_mode`; do not infer direct-only mode from
this listing or the two false flags. Model-specific code-mode behavior remains a
separate bounded authorized capability check, not a reason to copy credentials
or widen sandbox/provider authority.
