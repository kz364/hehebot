import { expect, it } from 'vitest';
import validateCommand from '../src/generated/validate-command.js';
import validateRuntime from '../src/generated/validate-runtime.js';
import { bot, otherBot } from './helpers';

const answer = { schema_version: 1, type: 'question.answer', payload: {
  question_id: bot, expected_revision: 1, answers: { destination: { answers: ['West'] }, timing: { answers: [] } },
} };
const record = { type: 'question-record', payload: {
  identity: { epoch: 3, boot_id: bot }, run_id: otherBot, attempt: 2,
  question: { id: bot, connection_id: otherBot, request_id: 0, params: {
    threadId: 'root-west', turnId: 'turn-18', itemId: 'call-7', isBlocking: false,
    questions: [{ id: 'destination', header: 'Destination', question: 'Which region?',
      options: [{ label: 'West', description: 'Western region' }, { label: 'East', description: 'Eastern region' }] }],
  } },
} };

it('accepts optional canonical host callback deadlines but not native-text declarations', () => {
  const request = record.payload.question;
  const withDeadline = (callback_deadline_at: unknown) => ({ ...record, payload: { ...record.payload,
    question: { ...request, callback_deadline_at } } });
  expect(validateRuntime(record)).toBe(true);
  expect(validateRuntime(withDeadline('2026-09-10T00:05:00.000Z'))).toBe(true);
  for (const value of [null, 300000, '2026-09-10T00:05:00Z', '2026-09-10T07:05:00.000+07:00', '2026-02-30T00:05:00.000Z']) {
    expect(validateRuntime(withDeadline(value))).toBe(false);
  }
  expect(validateRuntime({ ...record, payload: { ...record.payload, question: { ...request,
    params: { ...request.params, callback_deadline_at: '2026-09-10T00:05:00.000Z' } } } })).toBe(false);
});

it('requires explicit stopped-custody consent and excludes closure from the model command surface', () => {
  const close = { schema_version: 1, type: 'question.close', payload: {
    question_id: bot, expected_revision: 3, confirm_stopped_closure: true,
  } };
  expect(validateCommand(close)).toBe(true);
  for (const change of [{ confirm_stopped_closure: false }, { confirm_stopped_closure: undefined },
    { expected_revision: 0 }, { question_id: 'bad' }, { resolved: true }, { answers: {} }]) {
    expect(validateCommand({ ...close, payload: { ...close.payload, ...change } })).toBe(false);
  }
  expect(validateRuntime({ type: 'agent-command', payload: { identity: record.payload.identity,
    run_id: otherBot, attempt: 2, idempotency_key: 'closure-is-owner-only', command: close } })).toBe(false);
});

it('accepts exact owner answer envelopes including explicit skips and codepoint boundaries', () => {
  expect(validateCommand(answer)).toBe(true);
  expect(validateCommand({ ...answer, payload: { ...answer.payload, answers: { destination: { answers: ['🧭'.repeat(2000)] } } } })).toBe(true);
  for (const change of [{ expected_revision: 0 }, { expected_revision: Number.MAX_SAFE_INTEGER }, { question_id: 'bad' },
    { answers: {} }, { answers: { a: { answers: ['a', 'b'] } } }, { answers: { a: { answers: ['🧭'.repeat(2001)] } } },
    { answers: { a: { answers: [], approved: true } } }, { answers: { a: [], b: [] } }, { answers: { ['a'.repeat(129)]: { answers: [] } } },
    { answers: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { answers: [] }])) }, { run_id: otherBot }, { owner_id: 'claimed-owner' }]) {
    expect(validateCommand({ ...answer, payload: { ...answer.payload, ...change } })).toBe(false);
  }
});

it('bounds runtime question identity and rejects secrets, extra authority and malformed native fields', () => {
  expect(validateRuntime(record)).toBe(true);
  const request = record.payload.question;
  for (const request_id of [0, '0', -1, Number.MAX_SAFE_INTEGER, '🧭'.repeat(128)]) {
    expect(validateRuntime({ ...record, payload: { ...record.payload, question: { ...request, request_id } } })).toBe(true);
  }
  for (const request_id of [null, '', Number.MAX_SAFE_INTEGER + 1, 1.5, '🧭'.repeat(129)]) {
    expect(validateRuntime({ ...record, payload: { ...record.payload, question: { ...request, request_id } } })).toBe(false);
  }
  for (const change of [{ threadId: '' }, { turnId: 'x'.repeat(257) }, { itemId: null }, { isBlocking: 'false' },
    { autoResolutionMs: -1 }, { autoResolutionMs: Number.MAX_SAFE_INTEGER + 1 }, { questions: [] },
    { questions: Array(4).fill(request.params.questions[0]) },
    { questions: [{ ...request.params.questions[0], isSecret: true }] },
    { questions: [{ ...request.params.questions[0], question: 'x'.repeat(2001) }] }, { allowed_tools: ['grant'] }]) {
    expect(validateRuntime({ ...record, payload: { ...record.payload, question: { ...request, params: { ...request.params, ...change } } } })).toBe(false);
  }
});

it('requires connection custody on take/resolve and never allows owner answers through agent-command', () => {
  for (const type of ['question-take', 'question-resolve']) {
    const payload = { identity: record.payload.identity, question_id: bot, connection_id: otherBot };
    expect(validateRuntime({ type, payload })).toBe(true);
    for (const invalid of [{ ...payload, connection_id: undefined }, { ...payload, accepted: true }, { ...payload, answers: answer.payload.answers }]) {
      expect(validateRuntime({ type, payload: invalid })).toBe(false);
    }
  }
  expect(validateRuntime({ type: 'agent-command', payload: { identity: record.payload.identity,
    run_id: otherBot, attempt: 2, idempotency_key: 'owner-answer-not-agent', command: answer } })).toBe(false);
});
