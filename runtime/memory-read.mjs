import { createHash, randomUUID } from 'node:crypto';
import { countMemory } from './memory-tokenizer.mjs';

// Exact reviewed mapping, not a prefix admission rule or account eligibility.
// openai/tiktoken 4e71bbe0c078468e00fefbf94b39849389f346e5; MEMORY_TOKENIZER.md.
const MODELS = new Set(['gpt-5', 'gpt-5.4', 'gpt-5.5', 'gpt-5-codex']);
const TOKENIZER = 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1';
const fail = () => { throw new Error('MEMORY_READ_DENIED'); };
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function countSelectedModelMemory(input, options) {
  if (!MODELS.has(input.selected_model)) throw Object.assign(new Error('MEMORY_MODEL_UNSUPPORTED'), { code: 'MEMORY_MODEL_UNSUPPORTED' });
  return countMemory(input, options);
}

// Body-free handles cross asynchronous host layers. Only the final synchronous
// transport write materializes bytes. Nothing serializable here can replay text.
const deliveries = new WeakMap();
export function deferMemoryResponse(deliver) {
  const handle = Object.freeze({});
  let used = false;
  deliveries.set(handle, () => {
    if (used) fail();
    used = true;
    return deliver();
  });
  return handle;
}
export function materializeMemoryResponse(response) {
  return deliveries.has(response) ? deliveries.get(response)() : response;
}
export function mapMemoryResponse(response, transform) {
  return deliveries.has(response) ? deferMemoryResponse(() => transform(materializeMemoryResponse(response))) : transform(response);
}

/** Trusted host operation; args have already passed the model-facing schema.
 * Worker revalidates authority/source at reservation. Unknown delivery consumes
 * budget, with no automatic retry or refund. JSON-RPC ids are not read identities.
 */
export async function prepareMemoryDelivery({ controlClient, config, args, signal, now = Date.now, counter = countSelectedModelMemory }) {
  const request = { ...structuredClone(args), identity: structuredClone(config.identity),
    run_id: config.runId, attempt: config.attempt, read_id: randomUUID() };
  const budget = structuredClone(config.memoryBudget);
  if (!budget || !MODELS.has(budget.selected_model) || signal?.aborted) fail();
  const prepared = structuredClone(await controlClient.request('memory-read-prepare', request));
  if (!prepared || prepared.schema_version !== 1 || prepared.read_id !== request.read_id ||
      prepared.run_id !== request.run_id || prepared.attempt !== request.attempt ||
      prepared.selected_model !== budget.selected_model || prepared.baseline_sha256 !== budget.sha256 ||
      prepared.tokenizer !== TOKENIZER || !['global', 'scoped'].includes(prepared.bucket) ||
      typeof prepared.text !== 'string' || Buffer.byteLength(prepared.text, 'utf8') > 131072 ||
      prepared.sha256 !== sha256([1, request.identity.epoch, request.identity.boot_id, request.run_id, request.attempt,
        request.read_id, request.memory_id, request.revision, request.offset, request.limit,
        budget.sha256, budget.selected_model, prepared.bucket, prepared.text])) fail();
  const text = prepared.text;
  let expires = Date.parse(prepared.not_after);
  const assertCurrent = () => { if (signal?.aborted || !Number.isFinite(expires) || now() >= expires) fail(); };
  assertCurrent();
  const counts = await counter({ selected_model: budget.selected_model,
    global: prepared.bucket === 'global' ? text : '', scoped: prepared.bucket === 'scoped' ? text : '' },
  { timeoutMs: Math.max(1, Math.min(30000, Math.floor(expires - now()))), ...(signal ? { signal } : {}) });
  assertCurrent();
  const tokens = counts?.[`${prepared.bucket}_tokens`];
  const other = prepared.bucket === 'global' ? 'scoped_tokens' : 'global_tokens';
  if (counts?.schema_version !== 1 || counts.selected_model !== budget.selected_model || counts.tokenizer !== TOKENIZER ||
      !Number.isSafeInteger(tokens) || tokens < 1 || counts[other] !== 0) fail();
  const reservation = await controlClient.request('memory-read-reserve', { ...request, sha256: prepared.sha256,
    selected_model: budget.selected_model, tokenizer: TOKENIZER, tokens });
  if (reservation?.read_id !== request.read_id || reservation.sha256 !== prepared.sha256 ||
      reservation.reserved !== true || reservation.delivery_allowed !== true) fail();
  expires = Math.min(expires, Date.parse(reservation.not_after));
  assertCurrent();
  let taken = false;
  return () => {
    if (taken) fail();
    taken = true;
    assertCurrent();
    return text;
  };
}
