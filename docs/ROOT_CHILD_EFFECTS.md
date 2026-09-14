# Trusted root/descendant effect bookkeeping

`RootChildEffects(store, core, lifecycle)` adds a transactional trusted-executor
boundary over the existing `EffectLedger` and `ResourceLedger`. It is not a
model-callable effect tool, connector dispatcher, new scheduler, or authenticated
per-child MCP identity. The Worker exposes runtime-token-authenticated POST routes
`/internal/root-child-effect-intent` and `/internal/root-child-effect-result`.
Strict generated runtime schemas validate both envelopes before ledger access;
both routes retain the execution-enabled and native-verified admission gates.

```ts
type RootChildEffectIntent = {
  identity: Identity;
  root_run_id: string;
  root_attempt: number;
  effect: EffectIntent;
  resources: string[];
};
type RootChildEffectResult = {
  identity: Identity;
  root_run_id: string;
  root_attempt: number;
  run_id: string;
  attempt: number;
  effect_id: string;
  status: 'dispatched' | 'confirmed' | 'failed' | 'outcome_unknown';
  receipt: Record<string, unknown> | null;
};
```

`intent(input)` returns the original `{id, status}` receipt. `transition(input)`
returns void, like `EffectLedger.transition`. Neither invokes an external action.
Classification, original request digest, selected logical child and resources
must come from trusted connector/executor code, not untrusted model arguments.

## Admission checks the entire native ancestry

Both methods require a current lifecycle lease/epoch/boot and exact root/selected
child attempts. The root must be a coordinator without a parent; the subject
must be a different background descendant. Every `native_task_links` edge must
agree with `runs.parent_run_id`, the child's current attempt native reference,
and its parent's unchanged attempt number. All ancestors must belong to the
same executor. Missing edges, cycles, unrelated coordinators and stale attempts
are rejected rather than inferred from a latest turn or matching persona.

Every stored context must match the root's persona, routine and room scope;
context persona/routine IDs and canonical `scope_key` must match the run records.
Even a cross-persona child legally registered through a delegation is not
authorized by this same-root-scope boundary.

For new intent or replay still in `intent`, the selected child must be running.
The root and intermediate ancestors may be claimed, running, finishing or
completed. Completed root output is not descendant settlement. Waiting, failed,
cancelling, cancelled, recovery-required or queued ancestry rejects new work.
All ancestry attempt deadlines must remain in the future. Mutation/idempotent
policy must appear in both the stored original root and selected child snapshots;
current persona configuration cannot widen those snapshots. Read-only classification
skips the mutation-policy check; it is still a trusted connector classification.

## Custody and resources are bound in a versioned digest envelope

No new tables or shadow effect ledger are created. The existing `request_digest`
column stores this 143-character ASCII string, within its 256-character contract:

```text
root-child-v1:<custody hash>:<request hash>

custody hash = SHA256(UTF8(JSON.stringify([
  epoch, boot_id, root_run_id, root_attempt, child_run_id, child_attempt
])))

request hash = SHA256(UTF8(JSON.stringify([
  original_connector_request_digest, sorted_resource_names
])))
```

Hashes are lowercase hexadecimal. Resource names use the existing ledger grammar
`[a-zA-Z0-9:._/-]{1,256}`, are distinct, and are sorted lexicographically without
mutating caller input. Read-only accepts 0–8 resources; mutations and idempotent
effects require 1–8. Duplicates are rejected rather than silently removed.
The original connector digest remains bounded to 1–256 characters.

This binds trusted-executor metadata; **it is not a signature or cryptographic
authentication of a child caller**. No one should infer connector permission
from a resource name, digest, parent link, or possession of a lock.

The existing ledger independently binds action key, owning run, classification,
authorization reference and provider idempotency key. Same action key with a
different request, resource membership, root custody or child attempt conflicts.
Reversing resource order is identical; supplying a new effect ID with the same
action and envelope returns the original effect ID.

## Replay and reconciliation do not repeat actions or change locks

New/intent replay records a **child-owned** effect and acquires **child-owned**
locks within one outer database transaction. A conflict on any resource rolls
back a newly inserted effect and every partial lock. An existing intent remains
unchanged if reacquiring its complete original resource set fails.

Dispatched, outcome-unknown, confirmed and failed replays return original status
after validating lease, ancestry and the exact envelope, without reacquiring or
releasing resources. They may return during root/child cancellation or recovery
because this is status readback, not admission to dispatch. Callers must not treat
an existing `intent` receipt alone as proof that a connector may be dispatched
twice; the trusted connector retains its own dispatch/idempotency protocol.

Transition validates the stored custody prefix against the current exact root
and child attempts and rejects ordinary, non-mediated effect digests. It delegates
legal transitions and receipt validation unchanged to `EffectLedger`: terminal
confirmation/failure requires nonempty reconciliation evidence; repeated identical
status does not overwrite its existing receipt. Transition is allowed after the
task deadline or while task cancellation/recovery is pending, but never under an
expired lease, fenced lifecycle or changed ancestry/attempt.

There is **no automatic lock release, operation settlement, native cancellation,
run completion, retry, dispatch or sleep authorization**, including after an
effect is confirmed. Existing lifecycle blockers remain authoritative.

## Verification and limits

`npx vitest run tests/root-child-effects.test.ts` uses real SQLite and existing
native-task/lifecycle ledgers with synthetic metadata. The 13 tests cover nested
and sibling identities, root completion, permitted/denied states, scope/persona
separation, narrowed policies, stale leases/ancestry, malformed native references,
cycles, canonical replay versus changed custody/resources, partial-lock rollback,
unknown/terminal replay, receipt validation, deadlines and resource bounds.

`npx vitest run tests/root-child-effects-rpc.test.ts` additionally exercises the
real Worker HTTP handler, runtime-token checks, RPC, generated validation and
SQLite, with a mocked Cloudflare host and synthetic native observations. Owner
commands adopt a synthetic routine policy and start its root; runtime contracts
register and submit descendants. Five tests cover strict resource bounds and
unknown-field rejection, child-owned locks, partial-lock rollback, canonical
replay, custody rejection, reconciliation after owner cancellation, receipt
preservation, denied completion/sleep, token rejection and disabled production
defaults. These are in-process HTTP handler checks, not deployed HTTPS/Access
admission or live-native acceptance.

Neither suite executes native model turns, connector actions, providers or
authenticated per-child MCP calls. The existing generic effect routes remain
trusted-executor APIs, not a separate security principal or an untrusted-child
entry point. All production/execution gates remain unchanged. Durable root/descendant
snapshots, mappings and effects must remain available for reconciliation; this
module does not solve retention or recovery admission of missing records.
