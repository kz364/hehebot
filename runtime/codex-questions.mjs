import { createHash, randomUUID } from 'node:crypto';

const error = code => Object.assign(new Error(code), { code });
const check = (ok, code = 'QUESTION_INVALID_INPUT') => { if (!ok) throw error(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fields = (v, required, optional = []) => object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const text = (v, min, max) => typeof v === 'string' && v.length <= max * 2 && [...v].length >= min && [...v].length <= max && !/\p{Cs}/u.test(v);
const canonical = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const requestIdValid = v => Number.isSafeInteger(v) || text(v, 1, 128);
function validateParams(p) {
  check(fields(p, ['threadId', 'turnId', 'itemId', 'isBlocking', 'questions'], ['autoResolutionMs']) &&
    ['threadId', 'turnId', 'itemId'].every(k => text(p[k], 1, 256)) && typeof p.isBlocking === 'boolean' &&
    (p.autoResolutionMs == null || Number.isSafeInteger(p.autoResolutionMs) && p.autoResolutionMs >= 0) &&
    Array.isArray(p.questions) && p.questions.length >= 1 && p.questions.length <= 3);
  const ids = new Set();
  for (const q of p.questions) {
    check(fields(q, ['id', 'header', 'question'], ['isOther', 'isSecret', 'options']) && text(q.id, 1, 128) && !ids.has(q.id) &&
      text(q.header, 1, 80) && text(q.question, 1, 2000) && (q.isOther === undefined || typeof q.isOther === 'boolean') &&
      (q.isSecret === undefined || q.isSecret === false) && (q.options == null || Array.isArray(q.options) && q.options.length <= 3 &&
        q.options.every(o => fields(o, ['label', 'description']) && text(o.label, 1, 200) && text(o.description, 1, 1000))));
    ids.add(q.id);
  }
}
function validateAnswer(p, a) {
  check(fields(a, ['answers']) && object(a.answers) && Object.keys(a.answers).length === p.questions.length, 'QUESTION_INVALID_RESPONSE');
  for (const q of p.questions) {
    const v = a.answers[q.id];
    check(Object.hasOwn(a.answers, q.id) && fields(v, ['answers']) && Array.isArray(v.answers) && v.answers.length <= 1 &&
      v.answers.every(s => text(s, 0, 2000) && (!s || !q.options?.length || q.isOther || q.options.some(o => o.label === s))), 'QUESTION_INVALID_RESPONSE');
  }
  return structuredClone(a);
}
function validateBinding(b) {
  check(fields(b, ['identity', 'run_id', 'attempt', 'attemptId', 'deadline_at']) && fields(b.identity, ['epoch', 'boot_id']) &&
    Number.isSafeInteger(b.identity.epoch) && b.identity.epoch >= 0 && uuid(b.identity.boot_id) && uuid(b.run_id) &&
    Number.isSafeInteger(b.attempt) && b.attempt > 0 && typeof b.attemptId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(b.attemptId) &&
    canonical(b.deadline_at), 'QUESTION_UNBOUND');
  return structuredClone(b);
}
function bounded(promise, milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, error('QUESTION_ABORTED'));
    const timer = setTimeout(() => finish(reject, error('QUESTION_TIMEOUT')), milliseconds);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(v => finish(resolve, v), e => finish(reject, e));
  });
}
function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error('QUESTION_ABORTED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Opt-in connection binding only; callers install callbacks and retain exclusive FileJournal custody. */
export class CodexQuestionBinding {
  #entries = new Map(); #closed = false;
  constructor({ journal, control, resolveBinding, pollMs = 1000, timeoutMs = 30000, controlTimeoutMs = 15000, maxRequests = 64 } = {}) {
    check(journal && ['get', 'putIfAbsent', 'update'].every(k => typeof journal[k] === 'function') && typeof control?.request === 'function' &&
      typeof resolveBinding === 'function' && Number.isSafeInteger(pollMs) && pollMs >= 10 && pollMs <= 5000 &&
      Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 900000 && Number.isSafeInteger(controlTimeoutMs) && controlTimeoutMs >= 1 && controlTimeoutMs <= 60000 &&
      Number.isSafeInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 64, 'QUESTION_INVALID_CONFIGURATION');
    Object.assign(this, { journal, control, resolveBinding, pollMs, timeoutMs, controlTimeoutMs, maxRequests });
    Object.defineProperty(this, 'connectionId', { value: randomUUID(), enumerable: true });
  }
  #alive(e) { check(!this.#closed && !e.controller.signal.aborted && !e.resolutionObserved && Date.now() < e.deadline, 'QUESTION_ABORTED'); }
  async #binding(e, live) {
    const b = live ? validateBinding(await bounded(Promise.resolve().then(() => this.resolveBinding({ threadId: e.params.threadId, turnId: e.params.turnId })), this.controlTimeoutMs)) : e.binding;
    if (e.binding) check(['run_id', 'attempt', 'attemptId', 'deadline_at'].every(k => b[k] === e.binding[k]) &&
      b.identity.epoch === e.binding.identity.epoch && b.identity.boot_id === e.binding.identity.boot_id, 'QUESTION_STALE_BINDING');
    if (live) {
      this.#alive(e);
      if (!e.binding) {
        // The admitted deadline bounds the journal read too, not only later writes.
        e.deadline = Math.min(e.deadline, Date.parse(b.deadline_at));
        this.#alive(e);
        clearTimeout(e.timer);
        e.timer = setTimeout(() => e.controller.abort(), e.deadline - Date.now());
      }
    }
    const row = await bounded(this.journal.get(b.attemptId), this.controlTimeoutMs);
    check(row && row.threadId === e.params.threadId && row.nativeRunId === e.params.turnId &&
      (!live || row.rootSettled === false && row.status === 'running' && Date.parse(b.deadline_at) > Date.now()), 'QUESTION_UNBOUND');
    return b;
  }
  #serial(e, fn) {
    const next = e.tail.then(fn);
    e.tail = next.catch(cause => {
      if (!['QUESTION_ABORTED', 'QUESTION_UNBOUND', 'QUESTION_STALE_BINDING', 'QUESTION_NO_ANSWER'].includes(cause?.code)) e.blocked = true;
    });
    return next;
  }
  async #save(e, patch) { await bounded(this.journal.update(e.key, patch), this.controlTimeoutMs); }
  async #request(e, type, payload, phase) {
    check(!e.blocked, 'QUESTION_OUTCOME_UNKNOWN');
    await this.#save(e, { phase });
    if (type !== 'question-resolve') this.#alive(e);
    let started = false;
    try {
      return await bounded(Promise.resolve().then(() => {
        if (type !== 'question-resolve') this.#alive(e);
        started = true; return this.control.request(type, payload);
      }), this.controlTimeoutMs);
    } catch (cause) {
      if (!started && cause?.code === 'QUESTION_ABORTED') throw cause;
      e.blocked = true; throw error('QUESTION_CONTROL_UNKNOWN');
    }
  }
  onUserInput = (params, { signal, requestId } = {}) => {
    try {
      check(!this.#closed && signal instanceof AbortSignal && requestIdValid(requestId)); validateParams(params);
      check(!this.#entries.has(requestId) && this.#entries.size < this.maxRequests, 'QUESTION_REQUEST_CONFLICT');
      const startedAt = Date.now();
      const e = { params: structuredClone(params), requestId, id: randomUUID(), controller: new AbortController(),
        deadline: startedAt + this.timeoutMs, tail: Promise.resolve(), blocked: false, recorded: false, resolutionObserved: false };
      const input = { id: e.id, connection_id: this.connectionId, request_id: requestId, params: e.params,
        callback_deadline_at: new Date(e.deadline).toISOString() };
      check(Buffer.byteLength(JSON.stringify(input)) <= 65536);
      this.#entries.set(requestId, e);
      const abort = () => e.controller.abort();
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      e.timer = setTimeout(abort, this.timeoutMs);
      e.initialized = this.#serial(e, async () => {
        this.#alive(e); e.binding = await this.#binding(e, true); this.#alive(e);
        // Host clock metadata, not native question text. Record the same frozen
        // attempt-clamped deadline used by the callback and private journal.
        input.callback_deadline_at = new Date(e.deadline).toISOString();
        e.key = `question_${hash([e.binding.attemptId, e.params.threadId, e.params.turnId, e.params.itemId])}`;
        const existing = await bounded(this.journal.putIfAbsent(e.key, { version: 1, questionId: e.id, connectionId: this.connectionId,
          requestId, binding: e.binding, threadId: e.params.threadId, turnId: e.params.turnId, itemId: e.params.itemId,
          inputSha256: hash(input), phase: 'record_unknown', resolutionObserved: false,
          wait: { startedAt: new Date(startedAt).toISOString(), deadlineAt: new Date(e.deadline).toISOString() } }), this.controlTimeoutMs);
        check(existing === null, 'QUESTION_REPLAY_FORBIDDEN'); e.owned = true; this.#alive(e);
        const reply = await this.#request(e, 'question-record', { identity: e.binding.identity, run_id: e.binding.run_id, attempt: e.binding.attempt, question: input }, 'record_unknown');
        check(fields(reply, ['id']) && reply.id === e.id, 'QUESTION_INVALID_RESPONSE'); e.recorded = true;
        await this.#save(e, { phase: 'waiting' });
      });
      const run = async () => {
        await bounded(e.initialized, this.timeoutMs, e.controller.signal);
        while (true) {
          this.#alive(e);
          const answer = await bounded(this.#serial(e, async () => {
            this.#alive(e); await this.#binding(e, true); this.#alive(e);
            const reply = await this.#request(e, 'question-take', this.#payload(e), 'take_unknown');
            check(fields(reply, ['state', 'answer']), 'QUESTION_INVALID_RESPONSE');
            if (reply.state === 'pending' && reply.answer === null) { await this.#save(e, { phase: 'waiting' }); return null; }
            if (reply.state === 'response_unknown' && reply.answer !== null) {
              const value = validateAnswer(e.params, reply.answer);
              await this.#save(e, { phase: 'handoff_unknown' }); this.#alive(e); return value;
            }
            // A known no-answer state stops polling but can still receive native resolution.
            if (['response_unknown', 'resolved'].includes(reply.state) && reply.answer === null) throw error('QUESTION_NO_ANSWER');
            throw error('QUESTION_INVALID_RESPONSE');
          }), Math.max(1, e.deadline - Date.now()), e.controller.signal);
          this.#alive(e); if (answer !== null) return answer;
          await pause(Math.max(1, Math.min(this.pollMs, e.deadline - Date.now())), e.controller.signal);
        }
      };
      return run().catch(() => { throw error('QUESTION_CALLBACK_STOPPED'); }).finally(() => { clearTimeout(e.timer); signal.removeEventListener('abort', abort); });
    } catch { return Promise.reject(error('QUESTION_CALLBACK_REJECTED')); }
  };
  #payload(e) { return { identity: e.binding.identity, question_id: e.id, connection_id: this.connectionId }; }
  onNotification = async message => {
    if (message?.method !== 'serverRequest/resolved') return;
    check(fields(message.params, ['threadId', 'requestId']) && text(message.params.threadId, 1, 256) && requestIdValid(message.params.requestId));
    const e = this.#entries.get(message.params.requestId);
    if (!e || e.params.threadId !== message.params.threadId || this.#closed || e.resolutionObserved) return;
    e.resolutionObserved = true; e.controller.abort();
    try {
      await this.#serial(e, async () => {
        if (!e.owned) return;
        await this.#save(e, { resolutionObserved: true });
        if (!e.recorded || e.blocked) return;
        await this.#binding(e, false);
        const reply = await this.#request(e, 'question-resolve', this.#payload(e), 'resolve_unknown');
        check(fields(reply, ['ok']) && reply.ok === true, 'QUESTION_INVALID_RESPONSE');
        await this.#save(e, { phase: 'resolved' });
      });
    } catch { throw error('QUESTION_RESOLUTION_UNKNOWN'); }
  };
  close() { this.#closed = true; for (const e of this.#entries.values()) e.controller.abort(); }
}
