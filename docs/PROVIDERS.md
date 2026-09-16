# Runtime provider portability

Status: 2026-09-10. No provider account, runtime, deployment or paid resource was created. HTTP adapters below are implemented against retrieved official documentation and exercised with injected HTTP responses. They are not live-verified integrations. Container images, account entitlement, networking, runtime OAuth, state mounts and lifecycle configuration remain deployment gates.

The Cloudflare control plane selects an adapter with `createProvider({ provider, token })`; construct the token privately from Worker bindings. Persist only `RuntimeRef` (provider, opaque instance ID, optional scope and persistent-state ID). The domain never requires a Machine, volume or sandbox SDK object. The provider does not create replacement resources or automatically retry ambiguous mutations.

| Provider | Current implementation | Persistent state | Remaining gate |
| --- | --- | --- | --- |
| Fake | In-memory asynchronous lifecycle; explicit test completion | Simulated filesystem | Never production execution |
| Fly Machines | HTTP observe/start/stop, identity and volume-mount checks | Mounted volume | Preprovision one Machine; disable proxy autostop and automatic replacement; live mount/boot/stop proof |
| Daytona | HTTP observe/start/stop with lifecycle-policy preflight | Existing sandbox filesystem | Verify account network access, API response fixtures and preprovisioning; no TTL or auto-delete; auto-stop/pause disabled |
| Fly Sprites | Partial HTTP observe + Service start with NDJSON validation; VM stop unsupported | Native filesystem | Verify in-runtime Tasks lease bridge before enabling wake; no replacement-safe stop |
| Railway | GraphQL deployment observation, stop and gated restart | Volume requires separate verification | No documented authoritative STOPPED observation; automated replacement and complete stop/wake cycle remain gated |
| E2B | Worker-compatible REST bridge plus injectable SDK: getInfo/connect/filesystem-only pause | Pause snapshot | Verify cold boot protocol; controller pause reconciliation remains a gate |

`capabilities.implemented` and lifecycle flags describe this implementation, not the entire vendor product. No adapter falls back to fake or another paid provider. Missing tokens and unverified lifecycle gates fail as unconfigured. Individual unsafe/unsupported operations raise `ProviderError('unsupported')`. All five providers have a configuration path; completeness differs explicitly.

## Lifecycle and persistence contract

`wake` and `stop` only request a state transition. A successful HTTP result cannot be used as stop confirmation or runtime readiness. The caller must subsequently `observe`, durably reconcile the result, and run the authenticated supervisor boot handshake. An HTTP 404, unknown state, parse failure or timed-out mutation cannot establish termination. The controller owns operation IDs, deduplication, serialized commands, queue races and epoch fencing; no unverified provider idempotency header is sent.

For terminating adapters `executionStopped=true` means an explicit non-resumable stopped observation. A paused process image may become active again with stale epoch state; it is therefore conservative `unknown` until an adapter and supervisor prove rebind-before-admission. Replacement still requires the controller's lease/identity revocation protocol. This flag does not revoke external effects or prove mounted application data is valid. `persistentState=retained` means the observed storage relationship or documented sandbox retention exists; bootstrap must verify the actual checkpoint and exclusive filesystem lock.

Fly uses documented GET `/v1/apps/{app}/machines/{id}` and POST `/start`, `/stop`; `started` maps to running. Only `stopped` confirms termination; `suspended`, deleted and unexpected states do not. Matching the configured volume in `config.mounts` establishes the storage relationship. Fly account tokens stay in secret bindings. HTTP requests have a 15-second timeout and refuse redirects; error bodies and exception details are not exposed.

Daytona uses GET `/api/sandbox/{id}` and POST `/start`, `/stop`. Its direct Sandbox properties are validated conservatively; omitted required policy fields block start. Stop remains available when a lifecycle policy is unsafe, permitting fenced recovery. Provisioning must ensure a non-ephemeral sandbox, `autoStopInterval=0`, `autoPauseInterval=0` where supported, `autoDeleteInterval=-1`, and no wall-clock destruction deadline. Current HTTP fixture assumptions must be compared with a real account before execution is enabled.

Fly and Daytona do not have a native hold API implemented. `activityHold='controller'` means the controller keeps the runtime awake by withholding stop while its operation ledger is nonempty; `holdActivity` intentionally rejects native calls. This requires provider autosleep disabled. Do not claim a lease was registered with the vendor.

## Provider-specific constraints

Sprites HTTP wake starts an existing named Service and parses the streaming NDJSON for errors even when HTTP status is 200. Wake is gated by `lifecycleVerified`, an explicit assertion of independently verified Tasks wiring; the adapter does not implement that in-runtime bridge. Its `stop` remains unsupported. Sprites automatically transitions through warm suspension and cold stop. Files persist; cold wake starts processes afresh via Services. Tasks holds are registered through the in-runtime Unix socket, not an assumed external REST route. Merely stopping one Service would not prove all processes stopped, so the adapter does not equate those operations.

Daytona's lower account tiers restrict outbound networking. The earlier pricing comparison found unrestricted access begins at a tier requiring a $500 top-up; verify current requirements and the exact destination allowlist before choosing it. Internal background processes alone do not reliably reset its inactivity timer. Disabling auto-stop does not disable TTL.

Railway uses the documented GraphQL `deployment(id)` query plus `deploymentStop(id)` and `deploymentRestart(id)` mutations. It checks GraphQL errors even on HTTP 200, accepts project tokens through `Project-Access-Token` and account/workspace tokens through Bearer authorization. It never calls deploymentRemove or redeploy. Restart is allowed only for an observed SLEEPING or CRASHED deployment after configuration verification; SUCCESS needs no restart, and REMOVED blocks. The documented status list lacks STOPPED and REMOVED means removed, so `confirmedStop=false` and observations never claim termination. Root lifecycle must remain in recovery until stronger confirmation exists, even when stop mutation returns true. Railway sleeps after outbound inactivity, so connections can prevent sleep and quiet internal work can be missed. Hobby has a $5 minimum and a 5 GB volume allowance in the pricing review; recheck account limits. A vendor sleep feature is not sufficient evidence for safe application cancellation.

E2B normally retains memory as well as filesystem. This adapter explicitly calls `Sandbox.pause(id, {keepMemory:false})`, preserving disk with cold resume. It exposes `stopMode=pause-filesystem`, `executionPaused=true` for observed paused state, and never `executionStopped=true`; a paused observation alone cannot prove the kind of an older snapshot. `connect` requests a 30-minute session, requiring checkpoint/lease handling before expiry. `lifecycleVerified` asserts tested cold bootstrap; onTimeout pause and autoResume false are additionally checked through API readback. The factory now automatically supplies a Worker-compatible HTTP client, using `X-API-Key`, GET `/sandboxes/{id}`, POST `/connect` with timeout seconds, and POST `/pause` with `{memory:false}`. It normalizes REST `sandboxID` to SDK `sandboxId`, strips credential response fields, and checks lifecycle readback before connecting. A custom authenticated SDK remains injectable through the third factory argument `{e2b: client}`. No SDK dependency is bundled. The optional connect `memory:false` field is explicitly marked not implemented in the retrieved REST schema; this adapter never relies on it. The controller must record expected cold boot after its own filesystem-only pause and require a new bootstrap identity before admission; an older paused memory snapshot cannot be assumed cold. Hobby's documented continuous session limit is one hour; paid plans and lifecycle limits must be read from the actual account. Deadline expiry must park work and reconcile uncertain effects, not silently restart them.

## Migration

Keep the selected provider and RuntimeRef durable. Changing configuration is not a live migration. Drain and stop the old instance, confirm termination, revoke its runtime credential, export an encrypted application-state checkpoint, restore it to the new provider, then bind a new epoch and verify the exclusive state lock. Provider-native volumes and snapshots are not portable backups. Never start both providers over copies of the same production credentials. Rollback follows the same stop/revoke/restore sequence.

## Sources inspected

- [Fly Machine API](https://fly.io/docs/machines/api/machines-resource/) and [state lifecycle](https://fly.io/docs/machines/machine-states/).
- [Daytona sandboxes and lifecycle REST examples](https://www.daytona.io/docs/sandboxes), [Sandbox properties](https://www.daytona.io/docs/en/typescript-sdk/sandbox/), [network tiers](https://www.daytona.io/docs/en/network-limits/).
- [Sprites lifecycle](https://docs.sprites.dev/concepts/lifecycle/), [Tasks holds](https://docs.sprites.dev/keeping-sprites-running/), [Sprite API](https://docs.sprites.dev/api/dev-latest/sprites/), [Services API](https://docs.sprites.dev/api/dev-latest/services/).
- [Railway serverless behavior](https://docs.railway.com/deployments/serverless), [exact deployment GraphQL examples](https://docs.railway.com/integrations/api/manage-deployments), [authentication and errors](https://docs.railway.com/integrations/api).
- [E2B REST get](https://docs.e2b.dev/api-reference/sandboxes/get-sandbox), [REST connect](https://docs.e2b.dev/api-reference/sandboxes/connect-to-sandbox), [REST pause](https://docs.e2b.dev/api-reference/sandboxes/pause-sandbox).
- [E2B persistence](https://docs.e2b.dev/sandbox/persistence) and [SDK v2.38.2 static methods](https://docs.e2b.dev/sdk-reference/js-sdk/v2.38.2/sandbox).

Validation: `tests/providers.test.ts` covers request routes, explicit transition confirmation, unknown/paused states, volume identity, credential/reference checks, unknown mutation outcomes, policy preflight and unsupported providers. 44 provider tests passed; TypeScript check passed at handoff. All HTTP/SDK results are mocks; passing tests is not an account compatibility claim.

## Sprites initial-provider integration

The user selected Sprites for the first deployment. `SpritesTasksClient` now implements native task upsert, expiry readback, and release with absence confirmation through an injectable Unix-socket transport. This is actual wire-contract code exercised with fake transport, not a live bridge. The supervisor must bind that transport to Node `http.request` with `socketPath: '/.sprite/api.sock'`, `host: 'sprite'`, the supplied path/method, JSON content type/body and a bounded timeout. Do not route these requests to the public Sprites API. An optional identity-bound Tasks client supplied to `SpritesProvider` enables native `holdActivity`; Worker factory use without that client remains explicitly unsupported for holds.

Use an epoch-specific task name and a short bounded lease (for example five minutes, renewed every minute). Register and confirm its future expiry before starting inference, browser work, subprocesses or checkpoint writes. Renew only while the complete operation ledger requires activity. A failed renewal is a real safety signal: stop admission and cancel/flush before the confirmed hold expires. Never renew indefinitely just because the runtime service process exists. Each native task has a one-hour maximum, independent of the total process lifetime.

After the application drains, checkpoints, closes live tools and confirms cancellation, delete its own task and verify absence. This only permits provider idle detection; it does not force or confirm VM stop. Other tasks, sessions or connections may keep the Sprite active. The control plane should record an idle-permitted/sleeping state for the same owner instead of reusing a terminated-machine state. A subsequent warm wake resumes frozen processes; a cold wake discards memory and Services restart them. In both cases the supervisor must reconnect, validate the current epoch and obtain a fresh admission lease before running work. No replacement is authorized by task absence, service stop, or ambiguous provider state.

No documented whole-Sprite nondestructive stop operation was found in the current Sprite/Services API surface. The documented DELETE Sprite operation permanently removes associated resources and is deliberately excluded. A Service stop affects that process, not every process in the VM; the adapter retains `explicitStop=false` and `confirmedStop=false`. Thus Tasks plus correct application draining supports safe same-Sprite idling, but does not supply a whole-runtime emergency fencing primitive. Root controller integration must keep uncertain cancellation/effects in recovery rather than launching a second executor.

Official references: [Tasks wire API and one-hour lifetime](https://docs.sprites.dev/keeping-sprites-running/), [warm/cold lifecycle and persistent filesystem](https://docs.sprites.dev/concepts/lifecycle/), [Services lifecycle](https://docs.sprites.dev/concepts/services/), [Services API](https://docs.sprites.dev/api/dev-latest/services/), [Sprite API including destructive deletion](https://docs.sprites.dev/api/dev-latest/sprites/). Retrieved 2026-09-10. Provider suite now has 53 passing tests; no Sprites provisioning or live API calls were made.

Root integration update: fixed native Unix transport and activity guard are implemented in runtime/sprites-task-transport.mjs and runtime/sprites-activity-guard.mjs. The Cloudflare controller selects provider-idle behavior from provider capabilities; clean drain commits IDLE_PERMITTED and fences the prior boot. Next work starts a fresh epoch with the same persistent runtime. Recovery does not infer termination. Seven new controller tests pass. Supervisor service/warm wake notification/native execution and live persistence remain pending; see IMPLEMENTATION.md.

### Live Tasks wire verification (2026-09-14)

On the owner's existing authorized Sprite, `node scripts/test-sprites-tasks-live.mjs --live-test` passed using the real bundled `SpritesTasksClient` and fixed Unix transport: initial GET 404, PUT 200 with confirmed future expiry, renewal PUT 200 with later expiry, exact GET readback, DELETE 204 and final GET 404. No model/application work ran. Only the fixture's unique task was released and its uploaded temporary files removed. This is live hold/renew/release evidence, not proof of provider sleep, indefinite activity protection, warm/cold recovery or complete application drain.

The test exposed two mock-only assumptions: absent tasks return plain-text 404, and expiry readback has whole-second precision. The transport now parses JSON only for successful GETs and discards mutation/error bodies while retaining status. Requested TTL rounds outward to cover the required deadline; the one-hour wire cap and strict minimum-expiry readback check remain. At the one-hour boundary, insufficient readback still fails rather than weakening the deadline. Regressions cover both failures and their unsafe alternatives.

Build with `bash scripts/build-codex-service.sh` before running the live script inside an explicitly authorized Sprite. It is deliberately excluded from the credential-free wrapper. The script requests at most a 60-second required hold (rounded outward by less than a second), never activates routines, and never releases other tasks. Running it can incur provider compute charges.

### Selected-Sprite read-only containment decision (2026-09-16)

**Result: unknown for a protected supported containment boundary; cgroup primitives
are available.** Owner authorized inspection of the existing Sprite and up to $10
total for bounded wake/exec, not deployment, provisioning, configuration changes,
inference or cgroup mutations. Existing private CLI authentication was reused.

Control-plane GET identified existing `hehebot` as cold and its service list as
empty. Two synchronous `sprite exec -s hehebot --no-port-forward -- timeout -k 2s`
probes, bounded to 20s and 10s respectively, read identity, kernel/cgroup metadata,
permissions, namespace maps and helper availability. No helper was installed or
invoked for isolation. First probe ran 09:10:32–09:10:33 UTC; both returned normally.
Final control-plane read before 09:12:45 UTC reported cold again. No probe process
was left running and no application/model/connector was started.

| Direct observation | Meaning / limitation |
| --- | --- |
| Kernel `6.12.105-fly`; uid/gid 1001 (`sprite`); PID1 `tini` same uid | Actual selected guest, not orb evidence. |
| cgroup2 mounted rw at `/sys/fs/cgroup`; membership `0::/`; type `domain`; no direct child groups | A namespaced domain is exposed; no installation-owned generation exists yet. |
| `cgroup.kill`, `cgroup.procs`, `cgroup.subtree_control` present; effective access checks say writable | Promising capability, **not a tested write, kill or provider delegation guarantee**. Even read-only interface access checks can report writable under capabilities. |
| `populated 1`, `memory.max=max`, MemTotal 16,377,120 kB | Guest contains live processes; no termination or bounded-memory guarantee follows. |
| Effective/bounding capabilities `a82435fb`, including SYS_ADMIN, SETUID/SETGID, DAC_OVERRIDE, SYS_CHROOT | Current payload identity is privileged; shared-identity launch is not manager isolation. |
| `/.sprite/api.sock` root-owned mode 0666 and access-check writable | Capability drop alone would not hide the management socket. Reachability/authority must be constrained separately. No socket request was made by these probes. |
| `setpriv`, `unshare`, `chroot`, `timeout` installed; identity UID/GID maps | Supported OS building blocks exist, but no protected namespace/credential-drop boundary was exercised. |

Private evidence: `.local/sprite-containment-inspection.log`,
`.local/sprite-containment-identity.log`, `.local/sprite-containment-after.json`.
No credentials or auth caches were printed, copied or modified.

**Cost estimate, not receipt:** live [published pricing](https://sprites.dev/pricing)
on this date was $0.07/CPU-hour, $0.04375/GB-hour memory and $0.000683/GB-hour hot
storage. Before execution, an 8-vCPU/128-GiB/100-GB five-minute allowance was
estimated at about $0.52. Using observed guest memory rounded up to 16 GiB, the
same five-minute envelope is about $0.111; conservatively record **< $0.15 before
tax** for this bounded inspection, with actual execution much shorter. This does
not measure billed usage or imply an enforced provider cap. Existing cold storage
is not newly provisioned cost; no additional $10 was stacked onto prior authority.

**Next provider question:** is an installation-owned cgroup subtree plus a
distinct capability-dropped workload mount/user boundary excluding the management
socket and manager credentials supported across service restart/cold boot? If not,
is a generation-fenced recursive-stop/empty receipt available? Public service-stop
progress does not promise this; destructive Sprite deletion is not an alternative
within the grant. A real namespace/cgroup isolation test requires separate mutation
authorization, not more synthetic refusal tests.

**Owner-alpha consequence:** full recursive termination is a gate for autonomous
safe sleep/replacement, not automatically for displaying a supervised bounded
reply. A restricted alpha may retain unknown obligations, show persisted provisional
output and refuse automatic replay/sleep. Its actual reachable capabilities and
credential/effect boundary still need review; it cannot claim text-only isolation.
One specifically authorized real-model task and deployment remain separate grants.
