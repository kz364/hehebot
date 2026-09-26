-- Proposed application schema v1; no native harness tables are modified.
-- Validate JSON bodies with SCHEMAS/contracts.json and enforce ownership/references
-- inside one DO transaction before writes. SQLite is the logical storage model.
PRAGMA foreign_keys = ON;
CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO schema_versions VALUES (17, '2026-09-27T00:00:00.000Z');
CREATE TABLE objects (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('persona','room','routine','memory','skill','trigger','approval','policy')),
 revision INTEGER NOT NULL CHECK(revision > 0), body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX objects_kind_updated ON objects(kind,updated_at);
CREATE INDEX objects_memory_scope ON objects(json_extract(body_json,'$.scope.kind'),json_extract(body_json,'$.scope.id'),created_at,id) WHERE kind='memory' AND deleted_at IS NULL;
CREATE TABLE object_revisions (
 object_id TEXT NOT NULL REFERENCES objects(id), revision INTEGER NOT NULL,
 body_json TEXT NOT NULL CHECK(json_valid(body_json)), actor_id TEXT NOT NULL,
 source_event_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY(object_id,revision)
);
CREATE TABLE commands (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, body_hash TEXT NOT NULL,
 type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 status TEXT NOT NULL CHECK(status IN ('accepted','applied','rejected')),
 accepted_at TEXT NOT NULL, resource_id TEXT, error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX commands_payload_expiry ON commands(accepted_at,id) WHERE payload_json!='{}' AND status IN ('applied','rejected');
CREATE TABLE events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 conversation_id TEXT, type TEXT NOT NULL, actor_id TEXT NOT NULL, cause_id TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
);
CREATE INDEX events_conversation_sequence ON events(conversation_id,sequence);
CREATE INDEX events_created ON events(created_at,sequence);
CREATE TABLE event_tombstones (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, conversation_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX event_tombstones_conversation ON event_tombstones(conversation_id,sequence);
CREATE TABLE context_retention (
 consumer_id TEXT NOT NULL, conversation_id TEXT NOT NULL, pruned_through INTEGER NOT NULL,
 PRIMARY KEY(consumer_id,conversation_id)
);
-- Content-free publication identity survives timeline retention; not a full causal scheduler.
CREATE TABLE room_publications (
 event_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, actor_id TEXT NOT NULL, cause_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(room_id,actor_id,cause_id,payload_digest)
);
CREATE INDEX room_publications_cause ON room_publications(cause_id,kind);
CREATE TABLE consumer_cursors (
 consumer_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 delivered_sequence INTEGER NOT NULL DEFAULT 0, consumed_sequence INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(consumer_id,conversation_id), CHECK(consumed_sequence <= delivered_sequence)
);
CREATE TABLE "occurrences" (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES objects(id), routine_version INTEGER NOT NULL,
 nominal_due_at TEXT, status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','skipped','superseded','failed')),
 coalesced_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 origin TEXT NOT NULL DEFAULT 'scheduled' CHECK(origin IN ('scheduled','manual')),
 CHECK((origin='scheduled' AND nominal_due_at IS NOT NULL) OR (origin='manual' AND nominal_due_at IS NULL)),
 UNIQUE(routine_id,routine_version,nominal_due_at)
);
CREATE TABLE runs (
 id TEXT PRIMARY KEY, command_id TEXT REFERENCES commands(id), occurrence_id TEXT UNIQUE REFERENCES occurrences(id),
 persona_id TEXT NOT NULL REFERENCES objects(id), routine_id TEXT REFERENCES objects(id),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background')),
 parent_run_id TEXT REFERENCES runs(id), title TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','finishing','completed','waiting','failed','cancelling','cancelled','recovery_required')),
 current_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, checkpoint_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX runs_status_created ON runs(status,created_at);
CREATE INDEX runs_parent ON runs(parent_run_id,id);
CREATE TABLE attempts (
 run_id TEXT NOT NULL REFERENCES runs(id), attempt INTEGER NOT NULL CHECK(attempt > 0),
 submission_key TEXT NOT NULL UNIQUE, epoch INTEGER NOT NULL, boot_id TEXT NOT NULL,
 native_run_ref TEXT, status TEXT NOT NULL, deadline_at TEXT NOT NULL,
 started_at TEXT, settled_at TEXT, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), coordinator_release_json TEXT CHECK(coordinator_release_json IS NULL OR json_valid(coordinator_release_json)), captured_routine_revision INTEGER CHECK(captured_routine_revision IS NULL OR (typeof(captured_routine_revision)='integer' AND captured_routine_revision>0 AND captured_routine_revision<=9007199254740991)),
 PRIMARY KEY(run_id,attempt)
);
CREATE INDEX attempts_result_expiry ON attempts(settled_at,run_id,attempt) WHERE result_json IS NOT NULL AND settled_at IS NOT NULL AND status IN ('completed','failed','cancelled');
CREATE TABLE operations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('inference','tool','child','transfer','node','flush','delivery')),
 status TEXT NOT NULL CHECK(status IN ('active','cancelling','settled','unknown')),
 started_at TEXT NOT NULL, deadline_at TEXT NOT NULL, last_progress_at TEXT NOT NULL,
 FOREIGN KEY(run_id,attempt) REFERENCES attempts(run_id,attempt)
);
CREATE INDEX operations_status ON operations(status);
CREATE INDEX operations_run_status ON operations(run_id,status);
CREATE TABLE effects (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), action_key TEXT NOT NULL UNIQUE,
 classification TEXT NOT NULL CHECK(classification IN ('read_only','idempotent','mutation')),
 status TEXT NOT NULL CHECK(status IN ('intent','dispatched','confirmed','failed','outcome_unknown')),
 authorization_ref TEXT NOT NULL, request_digest TEXT NOT NULL, provider_idempotency_key TEXT,
 receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)), updated_at TEXT NOT NULL
);
CREATE INDEX effects_run_status ON effects(run_id,status);
CREATE TABLE lifecycle (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), provider_ref_json TEXT NOT NULL CHECK(json_valid(provider_ref_json)),
 boot_id TEXT, epoch INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL,
 desired_state TEXT NOT NULL CHECK(desired_state IN ('RUN','STOP')),
 lease_until TEXT, last_heartbeat TEXT, queue_sequence INTEGER NOT NULL DEFAULT 0,
 stop_token TEXT, provider_operation_id TEXT, wake_after_stop INTEGER NOT NULL DEFAULT 0 CHECK(wake_after_stop IN (0,1))
);
CREATE TABLE outbox (
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), destination TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed','outcome_unknown')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id,destination)
);
CREATE TABLE webhook_receipts (
 source_id TEXT NOT NULL REFERENCES objects(id), event_id TEXT NOT NULL,
 body_hash TEXT NOT NULL, command_id TEXT NOT NULL REFERENCES commands(id), received_at TEXT NOT NULL,
 PRIMARY KEY(source_id,event_id)
);

-- Portable scheduler/provider coordination additions. No provider-specific resource ID columns.
CREATE TABLE schedule_state (
 routine_id TEXT PRIMARY KEY REFERENCES objects(id), routine_version INTEGER NOT NULL,
 next_due_at TEXT NOT NULL, last_nominal_due_at TEXT
);
CREATE INDEX schedule_next_due ON schedule_state(next_due_at);
CREATE TABLE controller_operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('wake','stop','hold')),
 epoch INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','submitted','confirmed','failed','unknown')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, error_code TEXT, created_at TEXT NOT NULL
);
CREATE TABLE runtime_metadata (
 key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE rate_limits (
 subject TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(subject,window_start)
);
CREATE TABLE retry_queue (
 run_id TEXT PRIMARY KEY REFERENCES runs(id), due_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE INDEX retry_due ON retry_queue(due_at);

CREATE TABLE "native_task_links" (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL);
CREATE INDEX native_task_links_session ON native_task_links(native_session_key);
CREATE TABLE resource_locks (resource_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),attempt INTEGER NOT NULL,acquired_at TEXT NOT NULL);
CREATE INDEX resource_locks_run ON resource_locks(run_id);
CREATE TABLE task_followups (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','coordinator_queued','expired')),command_id TEXT NOT NULL REFERENCES commands(id),created_at TEXT NOT NULL,coordinator_run_id TEXT REFERENCES runs(id));
CREATE INDEX task_followups_expiry ON task_followups(created_at,id) WHERE text!='';
CREATE TABLE skill_proposals (
 id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, proposal_revision INTEGER NOT NULL,
 expected_skill_revision INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 executable_files_changed INTEGER NOT NULL CHECK(executable_files_changed IN (0,1)), actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL REFERENCES commands(id), reviewed_by TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
 UNIQUE(skill_id,proposal_revision)
);
CREATE INDEX skill_proposals_status ON skill_proposals(status,created_at);
CREATE TABLE skill_enablements (
 skill_id TEXT NOT NULL REFERENCES objects(id), persona_id TEXT NOT NULL REFERENCES objects(id),
 skill_revision INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL,
 PRIMARY KEY(skill_id,persona_id)
);
CREATE TABLE flight_restore_deadlines (
 leg_id TEXT NOT NULL, revision INTEGER NOT NULL, departure_at TEXT NOT NULL, departure_zone TEXT NOT NULL,
 restore_at TEXT NOT NULL, routine_id TEXT NOT NULL, source_ref TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','enqueued','confirmed','superseded','outcome_unknown')),
 run_id TEXT, receipt_json TEXT, PRIMARY KEY(leg_id,revision)
);

-- Committed bot messages (GROK_ALIGNMENT A1). One row per delivered hehebot_send_message
-- call or final_text fallback; the bot.message event is the durable record, this table
-- is the dedupe/rate-limit index over it.
CREATE TABLE bot_messages (
 message_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
 event_sequence INTEGER NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('tool','final_text')), created_at TEXT NOT NULL
);
CREATE INDEX bot_messages_run_attempt ON bot_messages(run_id,attempt);
