const TYPES = Object.freeze(['abandon', 'progress', 'whatsapp-read-authorize', 'agent-command', 'agent-routines', 'agent-skill', 'agent-skill-search', 'agent-task-list', 'agent-task-detail', 'question-record', 'question-take', 'question-resolve', 'output-preview', 'bot-message', 'token-usage', 'steer-pending', 'steer-result', 'budget-report', 'flight-register', 'flight-confirm', 'flight-reconcile', 'native-child', 'resource-acquire', 'resource-release', 'status', 'boot', 'ready', 'memory-prepare', 'memory-read-prepare', 'memory-read-reserve', 'claim', 'heartbeat', 'submitted', 'coordinator-release', 'complete', 'prepare-sleep', 'commit-sleep', 'effect-intent', 'effect-result', 'root-child-effect-intent', 'root-child-effect-result']);
export const RUNTIME_ENDPOINT_TYPES = TYPES;
const MANAGER_TYPES = Object.freeze(['manifest', 'retirement']);
const WARM_MANAGER_TYPES = Object.freeze(['generation', 'retirement']);
const WARM_HOST_TYPES = Object.freeze(['boot', 'ready', 'claim', 'heartbeat', 'submitted', 'coordinator-release', 'complete', 'status', 'output-preview', 'bot-message', 'token-usage', 'steer-pending']);
const WARM_TASK_TYPES = Object.freeze(['agent-routines', 'agent-skill', 'bot-message']);
const BACKGROUND_MANAGER_TYPES = Object.freeze(['generation', 'retirement']);
const BACKGROUND_HOST_TYPES = Object.freeze(['boot', 'ready', 'claim', 'heartbeat', 'submitted', 'coordinator-release', 'complete', 'status', 'output-preview', 'bot-message', 'token-usage', 'steer-pending', 'steer-result', 'native-child']);
const BACKGROUND_TASK_TYPES = Object.freeze(['agent-routines', 'agent-skill', 'bot-message']);
/** Route selection is not authentication; the Worker checks separate keys and
 * token kinds per principal. Warm and background principals never widen legacy
 * route meaning, and never reach each other's routes. */
const PRINCIPALS = Object.freeze({
  runtime: Object.freeze({ path: '/internal/', types: TYPES }),
  manager: Object.freeze({ path: '/internal/manager/', types: MANAGER_TYPES }),
  'warm-manager': Object.freeze({ path: '/internal/warm/manager/', types: WARM_MANAGER_TYPES }),
  'warm-host': Object.freeze({ path: '/internal/warm/host/', types: WARM_HOST_TYPES }),
  'warm-task': Object.freeze({ path: '/internal/warm/task/', types: WARM_TASK_TYPES }),
  'background-manager': Object.freeze({ path: '/internal/background/manager/', types: BACKGROUND_MANAGER_TYPES }),
  'background-host': Object.freeze({ path: '/internal/background/host/', types: BACKGROUND_HOST_TYPES }),
  'background-task': Object.freeze({ path: '/internal/background/task/', types: BACKGROUND_TASK_TYPES }),
});
export class ControlClientError extends Error {
  constructor(code, outcomeUnknown = false, status) {
    super(code); this.name = 'ControlClientError'; this.code = code; this.outcomeUnknown = outcomeUnknown;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, sent = false, status) => new ControlClientError(code, sent, status);
const secretValid = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\0]/.test(value);
/** Fixed-origin HTTPS client; every request is a potential mutation. No automatic retries. */
export class ControlClient {
  #origin; #headers; #fetch; #timeout; #requestLimit; #responseLimit; #types; #path;
  constructor({ origin, token, accessClientId, accessClientSecret, fetchImpl = globalThis.fetch,
    timeoutMs = 15000, maxRequestBytes = 131072, maxResponseBytes = 1048576, principal = 'runtime' } = {}) {
    let url; try { url = new URL(origin); } catch { throw fail('INVALID_CONFIGURATION'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !secretValid(token) || typeof fetchImpl !== 'function' || !Object.hasOwn(PRINCIPALS, principal)) throw fail('INVALID_CONFIGURATION');
    const accessSet = accessClientId !== undefined || accessClientSecret !== undefined;
    if (accessSet && (!secretValid(accessClientId) || !secretValid(accessClientSecret))) throw fail('INVALID_ACCESS_CREDENTIALS');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
      !Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 1048576 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4194304) throw fail('INVALID_LIMIT');
    this.#origin = url.origin;
    this.#headers = Object.freeze({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`,
      ...(accessSet ? { 'CF-Access-Client-Id': accessClientId, 'CF-Access-Client-Secret': accessClientSecret } : {}) });
    this.#fetch = fetchImpl; this.#timeout = timeoutMs; this.#requestLimit = maxRequestBytes; this.#responseLimit = maxResponseBytes;
    this.#types = PRINCIPALS[principal].types;
    this.#path = PRINCIPALS[principal].path;
  }
  async request(type, payload) {
    if (!this.#types.includes(type)) throw fail('UNSUPPORTED_RUNTIME_ENDPOINT');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('INVALID_PAYLOAD');
    let body;
    try { body = JSON.stringify(payload); } catch { throw fail('INVALID_PAYLOAD'); }
    if (typeof body !== 'string' || new TextEncoder().encode(body).byteLength > this.#requestLimit) throw fail('REQUEST_TOO_LARGE');
    const abort = new AbortController(); let reader;
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); void reader?.cancel().catch(() => {}); reject(fail('CONTROL_TIMEOUT', true)); }, this.#timeout); });
    const operation = (async () => {
      let response;
      try { response = await this.#fetch(`${this.#origin}${this.#path}${type}`, { method: 'POST', headers: { ...this.#headers }, body, signal: abort.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }); }
      catch { throw fail('CONTROL_TRANSPORT_FAILED', true); }
      if (!response || typeof response.status !== 'number' || !response.headers || response.redirected || response.status >= 300 && response.status < 400) throw fail('INVALID_CONTROL_RESPONSE', true);
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw fail('CONTROL_HTTP_ERROR', true, response.status); }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (mime !== 'application/json') { void response.body?.cancel().catch(() => {}); throw fail('INVALID_CONTROL_RESPONSE', true); }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.#responseLimit)) { void response.body?.cancel().catch(() => {}); throw fail('RESPONSE_TOO_LARGE', true); }
      if (!response.body) throw fail('INVALID_CONTROL_RESPONSE', true);
      reader = response.body.getReader(); let size = 0; let text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > this.#responseLimit) throw fail('RESPONSE_TOO_LARGE', true);
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) { if (error instanceof ControlClientError) throw error; throw fail('INVALID_CONTROL_RESPONSE', true); }
      let parsed; try { parsed = JSON.parse(text); } catch { throw fail('INVALID_CONTROL_RESPONSE', true); }
      if (type === 'steer-pending') {
        if (!Array.isArray(parsed) || parsed.length > 4) throw fail('INVALID_CONTROL_RESPONSE', true);
      } else if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw fail('INVALID_CONTROL_RESPONSE', true);
      // null is the documented empty claim result. Shape-specific checks belong to the supervisor.
      return parsed;
    })();
    try { return await Promise.race([operation, timeout]); }
    finally { clearTimeout(timer); abort.abort(); void reader?.cancel().catch(() => {}); }
  }
}
