# Selected configuration templates

`scripts/portable-template.mjs` exports selected configuration and generates an
offline, owner-reviewable import plan. It is **not a backup/restore tool**, an
automatic importer, or a grant of permission to run imported instructions.

Start from a private JSON response from the installation's authenticated
`GET /v1/state`. Store it outside Git with mode 0600. Select explicit UUIDs for
active personas, scheduled routines and reviewed skills; select each routine's
persona too. Trigger routines and archived personas are rejected.

```sh
node scripts/portable-template.mjs export /private/state.json PERSONA_UUID,ROUTINE_UUID,SKILL_UUID /private/template.json
node scripts/portable-template.mjs plan /private/template.json NAMESPACE_UUID /private/plan.json
```

Replace the placeholders with actual UUIDs and private absolute paths. Keep the
namespace UUID with the reviewed plan: the same namespace and unchanged template
produce stable new object IDs and idempotency keys. A different namespace or
template digest creates different objects. Outputs must not already exist; the
CLI creates them with mode 0600 and never makes network calls. Inputs must be
owner-owned regular private files no larger than 4 MiB, not symlinks.

The format strips persona/tool and routine/action policy IDs, disables imported
routines and stages skills as pending proposals. It omits credentials, connector
state, history, attachments, memory, active tasks, skill enablements and revision
history. Text may still contain private facts or unsafe instructions: review it
before sharing. The SHA-256 checksum detects changed bytes; it is not a signature
or evidence of trusted instructions. Schema and authority checks still apply if
someone recomputes the checksum.

Review every command and destination identity before explicitly applying commands
through `/v1/commands` with their matching `idempotency_key` headers. The tool does
not apply them. Creation uses revision zero and fresh IDs rather than overwriting
destination objects. The plan is **not atomic**: reconcile receipts after partial
application or a lost response, and stop on conflicts. Duplicate names or changed
destination revisions may require a revised plan, not blind retries. Review skill
proposals separately and adopt destination policies explicitly before enabling a
routine. No imported policy ID, historical enabled flag or instruction text can
authorize an effect.

`npx vitest run tests/portable-template.test.ts` verifies a SQLite round trip,
stripping of nonempty grants, disabled schedules, pending skill review, stable
receipts, checksum/schema rejection and private non-overwriting CLI output.
Coordinated native/control backups, account reauthorization, full state migration
and a portal import/reconciliation UI remain separate work.
