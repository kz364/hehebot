# Specification validation — 2026-09-10

Scope: documentation and contract artifacts only. No deployed service, model call, cloud resource, native runtime execution, or production integration was tested in this specification pass.

Passed:

- JSON Schema Draft 2020-12 meta-schema validation (`jsonschema` 4.26.0).
- Ten valid command examples accepted and four invalid examples rejected, with UUID format checks enabled.
- OpenAPI 3.1 validation including relative reference to the command schema (`openapi-spec-validator` 0.9.0).
- SQLite DDL loaded into an in-memory database; foreign-key check empty.
- All fixture JSON parsed; all nineteen numbered specification sections present in order.
- Independent runtime review integrated: native session scope isolation, parent yielding the single execution slot during child dispatch, and root/tool cancellation on lease loss.

Validators were installed in a temporary directory, not added to the product or system environment. Validation procedure: load `SCHEMAS/contracts.json` with `Draft202012Validator.check_schema`; validate `TEST_VECTORS/commands.json` with `FormatChecker`; call `openapi_spec_validator.validate` on `SCHEMAS/openapi.yaml` with its file URI as base; execute `DB/schema.sql` using in-memory `sqlite3`; check section ordering.

Not run: lifecycle vectors against an implementation, native OAuth/cancellation/activity tests, browser portal tests, WhatsApp catch-up, cost benchmark, backup restore, prior-bot exporter, or desktop bridge. These remain implementation gates in SPEC.md. The lifecycle JSON is a fixture specification, not evidence that the runtime behavior works.

2026-09-10 native-first extension: strict generated command/runtime contracts include `setup.adopt`, `run.followup`, `native-child`, resource acquire/release and flight register/confirm/reconcile. Application migration, import rollback, exact cancellation isolation and flight receipt tests are local. The native orchestration addendum supersedes the original single-turn concurrency default; O01–O09 are explicitly unverified end to end.
