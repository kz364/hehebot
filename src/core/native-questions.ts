import { ControlError, requireThat } from './errors';
import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';

export const NATIVE_QUESTION_PREFIX = 'native-question:';
export type NativeQuestion = { id: string; header: string; question: string; isOther?: boolean; isSecret?: boolean;
  options?: { label: string; description: string }[] | null };
export type NativeQuestionInput = { id: string; connection_id: string; request_id: string | number;
  params: { threadId: string; turnId: string; itemId: string; isBlocking: boolean; questions: NativeQuestion[]; autoResolutionMs?: number | null } };
export type NativeQuestionAnswers = Record<string, { answers: string[] }>;
export type NativeQuestionAnswerCommand = { question_id: string; expected_revision: number; answers: NativeQuestionAnswers };
export type NativeQuestionCloseCommand = { question_id: string; expected_revision: number; confirm_stopped_closure: true };
export type NativeQuestionRecord = NativeQuestionInput & { revision: number;
  run_id: string; attempt: number; epoch: number; boot_id: string; persona_id: string; conversation_id: string;
  created_at: string; expires_at: string; answers: NativeQuestionAnswers | null; answer_owner_id: string | null; answer_command_id: string | null;
  answered_at: string | null; response_taken_at: string | null; resolved_at: string | null } &
  ({ version: 1; state: 'pending' | 'answered' | 'response_unknown' | 'resolved' } |
   { version: 2; state: 'closed'; closed_at: string; close_owner_id: string; close_command_id: string });
export type NativeQuestionView = NativeQuestionRecord & { answerable: boolean; closeable: boolean };
const terminal = (r: NativeQuestionRecord) => r.state === 'resolved' || r.state === 'closed';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const text = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length <= max * 2 &&
  [...v].length >= min && [...v].length <= max && !/\p{Cs}/u.test(v);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const fields = (v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> => object(v) &&
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const invalid = (condition: unknown) => requireThat(condition, 'INVALID_INPUT', 'The native question data is invalid.', 422);

function normalize(input: NativeQuestionInput): NativeQuestionInput {
  invalid(fields(input, ['id', 'connection_id', 'request_id', 'params']) && bytes(input) <= 65536 && uuid(input.id) && uuid(input.connection_id) &&
    (typeof input.request_id === 'number' ? Number.isSafeInteger(input.request_id) : text(input.request_id, 1, 128)));
  const p = input.params;
  invalid(fields(p, ['threadId', 'turnId', 'itemId', 'isBlocking', 'questions'], ['autoResolutionMs']) &&
    [p.threadId, p.turnId, p.itemId].every(v => text(v, 1, 256)) && typeof p.isBlocking === 'boolean' &&
    (p.autoResolutionMs == null || Number.isSafeInteger(p.autoResolutionMs) && p.autoResolutionMs >= 0) && Array.isArray(p.questions) && p.questions.length >= 1 && p.questions.length <= 3);
  const ids = new Set<string>();
  const questions = p.questions.map(q => {
    invalid(fields(q, ['id', 'header', 'question'], ['options', 'isOther', 'isSecret']) && text(q.id, 1, 128) && !ids.has(q.id) &&
      text(q.header, 1, 80) && text(q.question, 1, 2000) && (q.isOther === undefined || typeof q.isOther === 'boolean') &&
      (q.isSecret === undefined || typeof q.isSecret === 'boolean') && (q.options == null || Array.isArray(q.options) && q.options.length <= 3 &&
        q.options.every(o => fields(o, ['label', 'description']) && text(o.label, 1, 200) && text(o.description, 1, 1000))));
    requireThat(q.isSecret !== true, 'NATIVE_QUESTION_SECRET_UNSUPPORTED', 'Secret native questions are not supported.', 422);
    ids.add(q.id);
    return { id: q.id, header: q.header, question: q.question, isOther: q.isOther ?? false, isSecret: false,
      options: q.options?.map(o => ({ label: o.label, description: o.description })) ?? null };
  });
  const normalized = { id: input.id, connection_id: input.connection_id, request_id: input.request_id,
    params: { threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, isBlocking: p.isBlocking, questions, autoResolutionMs: p.autoResolutionMs ?? null } };
  invalid(bytes(normalized) <= 65536); return normalized;
}
function answersFor(questions: NativeQuestion[], value: unknown): NativeQuestionAnswers {
  invalid(object(value) && Object.keys(value).length === questions.length);
  return Object.fromEntries(questions.map(q => {
    const row = (value as Record<string, unknown>)[q.id];
    invalid(Object.hasOwn(value as object, q.id) && fields(row, ['answers']) && Array.isArray(row.answers) && row.answers.length <= 1 &&
      row.answers.every(a => text(a, 0, 2000) && (!a || !q.options?.length || q.isOther || q.options.some(o => o.label === a))));
    return [q.id, { answers: (row as { answers: string[] }).answers.slice() }];
  }));
}
const inputOf = (r: NativeQuestionRecord): NativeQuestionInput => ({ id: r.id, connection_id: r.connection_id, request_id: r.request_id, params: r.params });

// Question bodies/answers are content (90d), not merely delivery metadata.
// Resolution alone never establishes task/effect settlement.
const retentionCandidates = `FROM runtime_metadata m
 JOIN runs r ON r.id=json_extract(m.value_json,'$.run_id')
 JOIN attempts a ON a.run_id=r.id AND a.attempt=json_extract(m.value_json,'$.attempt')
 WHERE m.key GLOB 'native-question:*' AND json_extract(m.value_json,'$.state') IN ('resolved','closed')
 AND r.status IN ('completed','failed','cancelled') AND a.status IN ('completed','failed','cancelled','terminated') AND a.settled_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM retry_queue q WHERE q.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled')
 AND NOT EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown'))`;
const retentionOrigin = "MAX(COALESCE(json_extract(m.value_json,'$.resolved_at'),json_extract(m.value_json,'$.closed_at')),a.settled_at)";

/** Trusted runtime custody and owner-answer queue, never approval, dispatch retry or task settlement. */
export class NativeQuestionLedger {
  constructor(private store: Store, private lifecycle: LifecycleCore, private now: () => string) {}
  nextExpiry(): string | null {
    return this.store.db.all<{ due: string | null }>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(${retentionOrigin}),'+90 days') AS due ${retentionCandidates}`)[0].due;
  }
  prune(): number {
    return this.store.db.transaction(() => {
      const cutoff = new Date(Date.parse(this.clock()) - 90 * 86400000).toISOString();
      const rows = this.store.db.all<{ key: string }>(`SELECT m.key ${retentionCandidates}
        AND ${retentionOrigin}<=? ORDER BY ${retentionOrigin},m.key LIMIT 100`, cutoff);
      for (const row of rows) {
        this.get(row.key.slice(NATIVE_QUESTION_PREFIX.length)); // Corruption is not permission to erase custody.
        this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', row.key);
      }
      return rows.length;
    });
  }
  private clock(): string { const now = this.now(); requireThat(timestamp(now), 'INVALID_INPUT', 'The question clock is invalid.', 422); return now; }
  private save(record: NativeQuestionRecord): void {
    this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
      NATIVE_QUESTION_PREFIX + record.id, JSON.stringify(record));
  }
  get(id: string): NativeQuestionRecord {
    invalid(uuid(id));
    const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', NATIVE_QUESTION_PREFIX + id)[0];
    requireThat(row, 'NOT_FOUND', 'Native question unavailable.', 404);
    try {
      invalid(row.value_json.length <= 131072 && new TextEncoder().encode(row.value_json).length <= 131072);
      const r = JSON.parse(row.value_json) as NativeQuestionRecord;
      invalid(fields(r, ['version', 'id', 'connection_id', 'request_id', 'params', 'revision', 'state', 'run_id', 'attempt', 'epoch', 'boot_id', 'persona_id',
        'conversation_id', 'created_at', 'expires_at', 'answers', 'answer_owner_id', 'answer_command_id', 'answered_at', 'response_taken_at', 'resolved_at',
        ...(r.version === 2 ? ['closed_at', 'close_owner_id', 'close_command_id'] : [])]));
      normalize(inputOf(r));
      invalid((r.version === 1 || r.version === 2 && r.state === 'closed') && r.id === id && uuid(r.run_id) && uuid(r.persona_id) && uuid(r.conversation_id) && uuid(r.boot_id) &&
        Number.isSafeInteger(r.attempt) && r.attempt > 0 && Number.isSafeInteger(r.epoch) && r.epoch >= 0 &&
        timestamp(r.created_at) && timestamp(r.expires_at) && r.expires_at > r.created_at && Date.parse(r.expires_at) - Date.parse(r.created_at) <= 900000);
      const answered = r.answers !== null, taken = r.response_taken_at !== null, resolved = r.state === 'resolved', closed = r.state === 'closed';
      invalid((r.version === 1 ? ['pending', 'answered', 'response_unknown', 'resolved'].includes(r.state) : closed) &&
        (answered ? text(r.answer_owner_id, 1, 256) && uuid(r.answer_command_id) && timestamp(r.answered_at) && r.answered_at >= r.created_at && r.answered_at < r.expires_at :
          r.answer_owner_id === null && r.answer_command_id === null && r.answered_at === null) &&
        (taken ? answered && timestamp(r.response_taken_at) && r.response_taken_at >= r.answered_at! && r.response_taken_at < r.expires_at : true) &&
        (resolved ? timestamp(r.resolved_at) && r.resolved_at >= (r.response_taken_at ?? r.answered_at ?? r.created_at) : r.resolved_at === null) &&
        (r.version === 2 ? timestamp(r.closed_at) && r.closed_at >= (r.response_taken_at ?? r.answered_at ?? r.created_at) &&
          text(r.close_owner_id, 1, 256) && uuid(r.close_command_id) : true) &&
        (r.state === 'pending' ? !answered && !taken : r.state === 'answered' ? answered && !taken : r.state === 'response_unknown' ? answered && taken : true) &&
        r.revision === 1 + Number(answered) + Number(taken) + Number(resolved || closed));
      if (answered) answersFor(r.params.questions, r.answers);
      return r;
    } catch { throw new ControlError('NATIVE_QUESTION_CORRUPT', 'Native question metadata requires review.'); }
  }
  private scan(visit: (r: NativeQuestionRecord) => void): number {
    const keys = this.store.db.all<{ key: string }>("SELECT key FROM runtime_metadata WHERE key GLOB 'native-question:*' ORDER BY key LIMIT 4097");
    requireThat(keys.length <= 4096, 'NATIVE_QUESTION_CAPACITY', 'Native question retention capacity requires review.');
    let unresolved = 0;
    for (const { key } of keys) {
      const id = key.slice(NATIVE_QUESTION_PREFIX.length);
      requireThat(uuid(id), 'NATIVE_QUESTION_CORRUPT', 'Native question metadata requires review.');
      const r = this.get(id); if (!terminal(r)) unresolved++; visit(r);
    }
    requireThat(unresolved <= 64, 'NATIVE_QUESTION_CAPACITY', 'Too many unresolved native questions.');
    return keys.length;
  }
  list(): NativeQuestionView[] {
    const result: NativeQuestionView[] = [];
    this.scan(r => {
      if (terminal(r)) return;
      let answerable = false;
      if (r.state === 'pending') {
        try { this.bound({ epoch: r.epoch, boot_id: r.boot_id }, r, r.connection_id, true); answerable = true; }
        catch (error) {
          if (!(error instanceof ControlError) || !['STALE_EPOCH', 'FORBIDDEN', 'REVISION_CONFLICT', 'DEADLINE_EXCEEDED',
            'CONTEXT_INVALIDATED', 'NATIVE_QUESTION_EXPIRED', 'NOT_FOUND'].includes(error.code)) throw error;
        }
      }
      if (result.length < 64) result.push({ ...r, answerable, closeable: this.stopped(r) });
    });
    return result.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }
  private authority(identity: Identity, runId: string, attempt: number, turn: string, live: boolean) {
    this.lifecycle.authorizeAttempt(identity, runId, attempt);
    const run = this.store.run(runId);
    requireThat(run.current_attempt === attempt, 'STALE_EPOCH', 'The original question attempt changed.');
    requireThat(run.role === 'coordinator' && run.parent_run_id === null, 'FORBIDDEN', 'Only a coordinator can own native questions.', 403);
    const native = this.store.db.all<{ native_run_ref: string | null; deadline_at: string }>('SELECT native_run_ref,deadline_at FROM attempts WHERE run_id=? AND attempt=?', runId, attempt)[0];
    requireThat(native?.native_run_ref === turn, 'FORBIDDEN', 'The native question turn does not match its attempt.', 403);
    if (live) {
      requireThat(['running', 'finishing'].includes(run.status) && !['OWNER_CANCELLED', 'CONTEXT_INVALIDATED'].includes(run.error_code ?? ''),
        'REVISION_CONFLICT', 'The question task no longer accepts answers.');
      requireThat(timestamp(native.deadline_at) && native.deadline_at > this.clock(), 'DEADLINE_EXCEEDED', 'The original task deadline expired.');
    }
    return { run, native };
  }
  private scope(run: { persona_id: string; context_json: string }): string {
    let context: unknown; try { context = JSON.parse(run.context_json); } catch { /* reject below */ }
    requireThat(object(context) && object(context.persona) && context.persona.id === run.persona_id &&
      (context.room_id == null || uuid(context.room_id)), 'CONTEXT_INVALIDATED', 'The captured question scope is unavailable.');
    return context.room_id as string | null ?? run.persona_id;
  }
  private bound(identity: Identity, r: NativeQuestionRecord, connection: string, live: boolean): void {
    requireThat(connection === r.connection_id && identity.epoch === r.epoch && identity.boot_id === r.boot_id,
      'STALE_EPOCH', 'The native question belongs to another connection or executor.');
    const { run } = this.authority(identity, r.run_id, r.attempt, r.params.turnId, live);
    if (live) {
      requireThat(run.persona_id === r.persona_id && this.scope(run) === r.conversation_id, 'CONTEXT_INVALIDATED', 'The question scope changed.');
      const now = this.clock(); requireThat(now >= r.created_at && now < r.expires_at, 'NATIVE_QUESTION_EXPIRED', 'The native question has expired.');
    }
  }
  record(identity: Identity, runId: string, attempt: number, input: NativeQuestionInput): string {
    return this.store.db.transaction(() => {
      invalid(uuid(runId) && uuid(identity.boot_id) && Number.isSafeInteger(identity.epoch) && identity.epoch >= 0 && Number.isSafeInteger(attempt) && attempt > 0);
      const normalized = normalize(input);
      const { run, native } = this.authority(identity, runId, attempt, normalized.params.turnId, true);
      const conversation = this.scope(run); let prior: NativeQuestionRecord | undefined, unresolved = 0;
      const total = this.scan(r => {
        if (!terminal(r)) unresolved++;
        if (r.id === input.id) prior = r;
        else requireThat(!(r.connection_id === normalized.connection_id && (r.request_id === normalized.request_id ||
          r.params.threadId === normalized.params.threadId && r.params.turnId === normalized.params.turnId && r.params.itemId === normalized.params.itemId)),
        'IDEMPOTENCY_CONFLICT', 'The native request already has another question identity.');
      });
      if (prior) {
        requireThat(prior.run_id === runId && prior.attempt === attempt && prior.epoch === identity.epoch && prior.boot_id === identity.boot_id &&
          prior.persona_id === run.persona_id && prior.conversation_id === conversation && JSON.stringify(normalize(inputOf(prior))) === JSON.stringify(normalized),
        'IDEMPOTENCY_CONFLICT', 'The question conflicts with its original native request.');
        return prior.id;
      }
      requireThat(total < 4096 && unresolved < 64, 'NATIVE_QUESTION_CAPACITY', 'Native question capacity requires review.');
      const now = this.clock(), expires_at = new Date(Math.min(Date.parse(now) + 900000, Date.parse(native.deadline_at))).toISOString();
      const r: NativeQuestionRecord = { ...normalized, version: 1, revision: 1, state: 'pending', run_id: runId, attempt, epoch: identity.epoch, boot_id: identity.boot_id,
        persona_id: run.persona_id, conversation_id: conversation, created_at: now, expires_at, answers: null, answer_owner_id: null, answer_command_id: null,
        answered_at: null, response_taken_at: null, resolved_at: null };
      this.save(r); return r.id;
    });
  }
  answer(owner: string, commandId: string, input: NativeQuestionAnswerCommand): string {
    return this.store.db.transaction(() => {
      invalid(fields(input, ['question_id', 'expected_revision', 'answers']) && uuid(input.question_id) && Number.isSafeInteger(input.expected_revision));
      const r = this.get(input.question_id), answers = answersFor(r.params.questions, input.answers);
      const command = this.store.db.all<{ owner_id: string; type: string; status: string; payload_json: string }>('SELECT owner_id,type,status,payload_json FROM commands WHERE id=?', commandId)[0];
      let payload: unknown; try { payload = command && JSON.parse(command.payload_json); } catch { /* fail below */ }
      requireThat(text(owner, 1, 256) && uuid(commandId) && command?.owner_id === owner && command.type === 'question.answer' && ['accepted', 'applied'].includes(command.status) &&
        fields(payload, ['question_id', 'expected_revision', 'answers']) && payload.question_id === input.question_id && payload.expected_revision === input.expected_revision &&
        JSON.stringify(answersFor(r.params.questions, payload.answers)) === JSON.stringify(answers), 'FORBIDDEN', 'An accepted matching owner answer command is required.', 403);
      requireThat(r.state === 'pending' && r.revision === input.expected_revision, 'REVISION_CONFLICT', 'The native question changed.');
      this.bound({ epoch: r.epoch, boot_id: r.boot_id }, r, r.connection_id, true);
      r.answers = answers; r.answer_owner_id = owner; r.answer_command_id = commandId; r.answered_at = this.clock(); r.state = 'answered'; r.revision++;
      this.save(r); return r.id;
    });
  }
  takeAnswer(identity: Identity, id: string, connectionId: string): { answers: NativeQuestionAnswers } | null {
    return this.store.db.transaction(() => {
      const r = this.get(id); this.bound(identity, r, connectionId, false);
      if (r.state !== 'answered') return null;
      this.bound(identity, r, connectionId, true);
      r.state = 'response_unknown'; r.response_taken_at = this.clock(); r.revision++; this.save(r);
      return { answers: r.answers! };
    });
  }
  resolve(identity: Identity, id: string, connectionId: string): void {
    this.store.db.transaction(() => {
      const r = this.get(id); this.bound(identity, r, connectionId, false); if (r.state === 'resolved') return;
      requireThat(r.state !== 'closed', 'REVISION_CONFLICT', 'Stopped question custody was already closed.');
      const now = this.clock(); requireThat(now >= (r.response_taken_at ?? r.answered_at ?? r.created_at), 'INVALID_INPUT', 'The question clock moved backwards.', 422);
      r.state = 'resolved'; r.resolved_at = now; r.revision++; this.save(r);
    });
  }

  private stopped(r: NativeQuestionRecord): boolean {
    const attempt = this.store.db.all<{ status: string; settled_at: string | null; epoch: number; boot_id: string; native_run_ref: string | null }>(
      'SELECT status,settled_at,epoch,boot_id,native_run_ref FROM attempts WHERE run_id=? AND attempt=?', r.run_id, r.attempt)[0];
    return attempt?.status === 'terminated' && attempt.epoch === r.epoch && attempt.boot_id === r.boot_id &&
      attempt.native_run_ref === r.params.turnId && timestamp(attempt.settled_at) &&
      attempt.settled_at >= (r.response_taken_at ?? r.answered_at ?? r.created_at) && this.clock() >= attempt.settled_at;
  }

  /** Owner custody closure after provider-confirmed termination, NOT native
   * resolution, answer delivery, effect reconciliation, or a retry instruction. */
  closeStopped(owner: string, commandId: string, input: NativeQuestionCloseCommand): string {
    return this.store.db.transaction(() => {
      invalid(fields(input, ['question_id', 'expected_revision', 'confirm_stopped_closure']) && uuid(input.question_id) &&
        Number.isSafeInteger(input.expected_revision) && input.confirm_stopped_closure === true);
      const r = this.get(input.question_id);
      const command = this.store.db.all<{ owner_id: string; type: string; status: string; payload_json: string }>(
        'SELECT owner_id,type,status,payload_json FROM commands WHERE id=?', commandId)[0];
      let payload: unknown; try { payload = command && JSON.parse(command.payload_json); } catch { /* reject below */ }
      requireThat(text(owner, 1, 256) && uuid(commandId) && command?.owner_id === owner && command.type === 'question.close' &&
        ['accepted', 'applied'].includes(command.status) && fields(payload, ['question_id', 'expected_revision', 'confirm_stopped_closure']) &&
        payload.question_id === r.id && payload.expected_revision === input.expected_revision && payload.confirm_stopped_closure === true,
      'FORBIDDEN', 'An accepted matching owner closure command is required.', 403);
      requireThat(!terminal(r) && r.revision === input.expected_revision, 'REVISION_CONFLICT', 'The native question changed.');
      requireThat(this.stopped(r), 'CANCEL_UNCONFIRMED', 'The original executor must be confirmed terminated.');
      this.save({ ...r, version: 2, state: 'closed', revision: r.revision + 1,
        closed_at: this.clock(), close_owner_id: owner, close_command_id: commandId });
      return r.id;
    });
  }
}
