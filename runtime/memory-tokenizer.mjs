// Bounded o200k_base memory-bucket token counter for the runtime supervisor.
//
// Scope: countMemory({selected_model, global, scoped}, {timeoutMs, signal})
// returns exact ordinary-text token counts for the two serialized memory
// bucket strings using the pinned narrow candidate
// `gpt-tokenizer/encoding/o200k_base` (merge cache size 0, empty
// allowedSpecial/disallowedSpecial sets, special literals counted as ordinary
// text). selected_model is validated and echoed only; model mapping and
// eligibility are not decided here.
//
// Execution: tokenization is synchronous CPU work, so it runs in an owned
// Node worker_threads worker (one per call, memory-bounded via
// resourceLimits, deadline via timeoutMs). The supervisor event loop is never
// blocked. The owned worker is terminated and awaited on success, timeout,
// abort, and worker failure, so no worker is ever left running behind a
// settled promise.
//
// Boundaries: the combined UTF-8 byte size of global+scoped must not exceed
// 131072 bytes (lone surrogates count as their U+FFFD replacement, matching
// the encoder's own input semantics), and is rejected before any worker
// starts. The unit performs no network access, filesystem credential reads,
// model inference, or external actions; its only imports are
// node:worker_threads and the pinned tokenizer package.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const TOKENIZER_ID = 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1';
const TOKENIZER_VERSION = '4.0.0';
const MODEL_ID = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_COMBINED_BYTES = 131072;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 60000;
const WORKER_KIND = 'hehebot.memory-tokenizer.worker.v1';
const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 };

const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };
const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const ENCODER = new TextEncoder();

// Owned-worker observation. Private narrow hook for tests (Symbol.for-keyed,
// non-enumerable): it reports how many owned workers are currently live.
// Nothing else in the public surface exists for tests.
let activeWorkers = 0;
const OBSERVE = Symbol.for('hehebot.memory-tokenizer.observe');

async function runWorkerEntry(port, data) {
  try {
    const { encode, setMergeCacheSize } = await import('gpt-tokenizer/encoding/o200k_base');
    const pkg = await import('gpt-tokenizer/package.json', { with: { type: 'json' } });
    if (pkg.default?.version !== TOKENIZER_VERSION) {
      throw new Error(`gpt-tokenizer ${pkg.default?.version} is installed; this counter is pinned to ${TOKENIZER_ID}`);
    }
    setMergeCacheSize(0);
    const special = { allowedSpecial: new Set(), disallowedSpecial: new Set() };
    const global_tokens = encode(data.global, special).length;
    const scoped_tokens = encode(data.scoped, special).length;
    port.postMessage({ ok: true, global_tokens, scoped_tokens });
  } catch (error) {
    port.postMessage({ ok: false, error: String(error && error.message || error) });
  }
}

// Self-entry: this same module file is the worker entry, selected by
// workerData.kind. The supervisor import (isMainThread) never runs this.
if (!isMainThread && workerData?.kind === WORKER_KIND) {
  await runWorkerEntry(parentPort, workerData);
}

/**
 * Count ordinary-text o200k_base tokens of the two serialized memory buckets.
 *
 * @param {{selected_model: string, global: string, scoped: string}} input
 *   exact serialized memory bucket strings; both buckets may be empty.
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
 *   timeoutMs defaults to 30000 and must be an integer in 1..60000; the
 *   owned worker is terminated and awaited when the deadline, abort, or
 *   worker failure fires.
 * @returns {Promise<{schema_version: 1, selected_model: string,
 *   tokenizer: string, global_tokens: number, scoped_tokens: number}>}
 */
export async function countMemory(input, options = {}) {
  if (!isPlainObject(options)) fail('INVALID_OPTIONS', 'options must be an object');
  for (const key of Object.keys(options)) {
    if (key !== 'timeoutMs' && key !== 'signal') fail('INVALID_OPTIONS', `unknown option: ${key}`);
  }
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    fail('INVALID_OPTIONS', `timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_OPTIONS', 'signal must be an AbortSignal');

  if (!isPlainObject(input)) fail('INVALID_INPUT', 'input must be an object');
  for (const key of Object.keys(input)) {
    if (key !== 'selected_model' && key !== 'global' && key !== 'scoped') fail('INVALID_INPUT', `unknown input field: ${key}`);
  }
  for (const field of ['selected_model', 'global', 'scoped']) {
    if (!(field in input)) fail('INVALID_INPUT', `missing input field: ${field}`);
  }
  const { selected_model, global, scoped } = input;
  if (typeof selected_model !== 'string' || !MODEL_ID.test(selected_model)) {
    fail('INVALID_INPUT', 'selected_model must be a nonempty string matching /^[a-zA-Z0-9._-]{1,128}$/');
  }
  if (typeof global !== 'string') fail('INVALID_INPUT', 'global must be a string');
  if (typeof scoped !== 'string') fail('INVALID_INPUT', 'scoped must be a string');
  const combinedBytes = ENCODER.encode(global).length + ENCODER.encode(scoped).length;
  if (combinedBytes > MAX_COMBINED_BYTES) {
    fail('INVALID_INPUT', `combined memory bucket size ${combinedBytes} bytes exceeds the ${MAX_COMBINED_BYTES} byte limit`);
  }
  const aborted = () => Object.assign(new Error('TOKENIZER_ABORTED'), { code: 'TOKENIZER_ABORTED', name: 'AbortError' });
  if (signal?.aborted) throw aborted();

  return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { kind: WORKER_KIND, global, scoped },
      resourceLimits: WORKER_RESOURCE_LIMITS,
      // The owned worker must load this module file regardless of how the
      // supervisor process was launched (eval/STDIN entry styles propagate
      // entry-only flags like --input-type through the default execArgv).
      execArgv: [],
    });
    activeWorkers += 1;
    let settled = false;
    let timer = null;
    const settle = action => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      action();
    };
    // Deterministic cleanup: the owned worker is terminated and the promise
    // only settles once termination has been awaited, on every exit path.
    const terminateAnd = decide => {
      worker.removeAllListeners();
      worker.terminate().then(() => {
        activeWorkers -= 1;
        decide();
      }, () => {
        activeWorkers -= 1;
        decide();
      });
    };
    const onAbort = () => settle(() => terminateAnd(() => reject(aborted())));
    const onTimeout = () => settle(() => terminateAnd(() => reject(Object.assign(
      new Error(`memory tokenizer worker timed out after ${timeoutMs}ms`),
      { code: 'TOKENIZER_TIMEOUT' },
    ))));
    const onMessage = data => {
      if (settled) return;
      if (data?.ok !== true ||
          !Number.isSafeInteger(data.global_tokens) || data.global_tokens < 0 ||
          !Number.isSafeInteger(data.scoped_tokens) || data.scoped_tokens < 0) {
        return settle(() => terminateAnd(() => reject(Object.assign(
          new Error(`memory tokenizer worker returned an invalid result: ${JSON.stringify(data)}`),
          { code: 'TOKENIZER_WORKER_FAILED' },
        ))));
      }
      const result = {
        schema_version: 1,
        selected_model,
        tokenizer: TOKENIZER_ID,
        global_tokens: data.global_tokens,
        scoped_tokens: data.scoped_tokens,
      };
      settle(() => terminateAnd(() => resolve(result)));
    };
    const onWorkerError = error => settle(() => terminateAnd(() => reject(Object.assign(
      new Error(`memory tokenizer worker failed: ${error && error.message}`),
      { code: 'TOKENIZER_WORKER_FAILED' },
    ))));
    const onExit = exitCode => settle(() => terminateAnd(() => reject(Object.assign(
      new Error(`memory tokenizer worker exited before returning a result (exit code ${exitCode})`),
      { code: 'TOKENIZER_WORKER_FAILED' },
    ))));
    timer = setTimeout(onTimeout, timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    worker.on('message', onMessage);
    worker.on('error', onWorkerError);
    worker.on('exit', onExit);
  });
}

Object.defineProperty(countMemory, OBSERVE, {
  enumerable: false,
  configurable: false,
  writable: false,
  value: () => ({ activeWorkers }),
});
