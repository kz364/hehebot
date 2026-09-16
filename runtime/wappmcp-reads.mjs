// Host boundary for the source-inspected wappmcp 0.4.0 contract. No installation,
// pairing, tool registration or grant issuance occurs here.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const string = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cs}]/u.test(value);
const integer = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max;
const tools = ['whatsapp_get_chat_messages', 'whatsapp_search_messages'];

/** grant must come from the authenticated host's admitted task snapshot, never
 * model arguments or imported text. Caller supplies current lease/revocation checks
 * and supplies deadlineAt from the admitted attempt, not model arguments.
 * Caller owns the one-installation MCP connection. This module grants no runtime access.
 */
export async function readWappMcp(grant, name, args, call, options = {}) {
  if (!object(options) || !Object.keys(options).every(key => ['signal', 'timeoutMs', 'deadlineAt', 'authorize'].includes(key)) ||
      options.signal !== undefined && !(options.signal instanceof AbortSignal) ||
      Object.hasOwn(options, 'authorize') && typeof options.authorize !== 'function' ||
      !integer(Object.hasOwn(options, 'timeoutMs') ? options.timeoutMs : 120000, 120000)) fail('WHATSAPP_READ_DENIED');
  const { signal, timeoutMs = 120000, authorize } = options;
  let taskDeadline = Infinity;
  if (Object.hasOwn(options, 'deadlineAt')) {
    if (typeof options.deadlineAt !== 'string') fail('WHATSAPP_READ_DENIED');
    taskDeadline = Date.parse(options.deadlineAt);
    if (!Number.isFinite(taskDeadline) ||
        new Date(taskDeadline).toISOString() !== options.deadlineAt) fail('WHATSAPP_READ_DENIED');
  }
  if (!exact(grant, ['chatIds', 'tools']) || !Array.isArray(grant.chatIds) || grant.chatIds.length > 100 ||
      !grant.chatIds.every(id => string(id, 256)) || new Set(grant.chatIds).size !== grant.chatIds.length ||
      !Array.isArray(grant.tools) || !grant.tools.every(tool => tools.includes(tool)) ||
      new Set(grant.tools).size !== grant.tools.length || !tools.includes(name) || !grant.tools.includes(name) ||
      typeof call !== 'function') fail('WHATSAPP_READ_DENIED');
  const search = name === 'whatsapp_search_messages';
  if (!object(args) || !Object.keys(args).every(key => (search ? ['chatId', 'query', 'page', 'limit'] : ['chatId', 'limit']).includes(key)) ||
      !Object.hasOwn(args, 'chatId') || !string(args.chatId, 256) || !grant.chatIds.includes(args.chatId) ||
      (search && (!Object.hasOwn(args, 'query') || !string(args.query, 1000)))) fail('WHATSAPP_READ_DENIED');
  const limit = Object.hasOwn(args, 'limit') ? args.limit : 50;
  const page = Object.hasOwn(args, 'page') ? args.page : 1;
  if (!integer(limit, 100) || !integer(page, 100)) fail('WHATSAPP_READ_DENIED');
  // Copy all admitted values before awaiting untrusted upstream code.
  const admitted = { chatId: args.chatId, limit, ...(search ? { query: args.query, page } : {}) };
  const controller = new AbortController(), deadline = Math.min(Date.now() + timeoutMs, taskDeadline);
  if (Date.now() >= deadline) fail('WHATSAPP_READ_STOPPED');
  const result = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); fn(value);
    };
    const stopped = () => Object.assign(new Error('WHATSAPP_READ_STOPPED'), { code: 'WHATSAPP_READ_STOPPED' });
    const stop = () => { finish(reject, stopped()); controller.abort(); };
    const timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener('abort', stop, { once: true });
    const checkAuthority = async () => {
      if (!authorize) return;
      let allowed = false;
      try {
        allowed = await authorize(Object.freeze({ name, chatId: admitted.chatId }), { signal: controller.signal });
      } catch { /* Never expose host custody errors or credentials. */ }
      if (allowed !== true) fail('WHATSAPP_READ_DENIED');
    };
    Promise.resolve().then(async () => {
      // Keep both host checks inside the same timeout/cancellation envelope.
      // Never start a read after a late authorization response.
      if (controller.signal.aborted || signal?.aborted || Date.now() >= deadline) { stop(); return; }
      if (authorize) await checkAuthority();
      if (controller.signal.aborted || signal?.aborted || Date.now() >= deadline) { stop(); return; }
      let value;
      try { value = await call(name, { ...admitted }, { signal: controller.signal }); }
      catch { fail('WHATSAPP_READ_FAILED'); }
      if (controller.signal.aborted || signal?.aborted || Date.now() >= deadline) { stop(); return; }
      if (authorize) await checkAuthority();
      return value;
    }).then(value => finish(resolve, value), error => {
      controller.abort(); finish(reject, error);
    });
  });
  if (signal?.aborted || controller.signal.aborted || Date.now() >= deadline) {
    controller.abort(); fail('WHATSAPP_READ_STOPPED');
  }
  // Never pass upstream text/error/resource blocks through: only the checked
  // structured JSON crosses the boundary, without inferred complete coverage.
  let output;
  try {
    if (!object(result) || result.isError === true || !Object.hasOwn(result, 'structuredContent')) fail('WHATSAPP_READ_INVALID');
    const json = JSON.stringify(result.structuredContent);
    if (typeof json !== 'string' || Buffer.byteLength(json) > 1048576) fail('WHATSAPP_READ_INVALID');
    const value = JSON.parse(json), messages = search ? value?.messages : value;
    if (search && (!exact(value, ['messages', 'meta']) || !exact(value.meta, ['q', 'chat', 'page', 'limit']) ||
        !exact(value.meta.chat, ['id']) || value.meta.chat.id !== admitted.chatId || value.meta.q !== admitted.query ||
        value.meta.page !== page || value.meta.limit !== limit)) fail('WHATSAPP_READ_INVALID');
    if (!Array.isArray(messages) || messages.length > limit) fail('WHATSAPP_READ_INVALID');
    const ids = new Set();
    for (const message of messages) {
      if (!object(message) || !string(message.id, 512) || ids.has(message.id) || !object(message.chat) ||
          message.chat.id !== admitted.chatId || typeof message.body !== 'string' ||
          typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp)) ||
          new Date(message.timestamp).toISOString() !== message.timestamp) fail('WHATSAPP_READ_INVALID');
      ids.add(message.id);
    }
    output = { chatId: admitted.chatId, messages: messages.map(({ id, body, timestamp }) => ({ id, body, timestamp })), coverage: 'unknown',
      ...(search ? { query: admitted.query, page } : {}) };
  } catch { fail('WHATSAPP_READ_INVALID'); }
  if (signal?.aborted || Date.now() >= deadline) { controller.abort(); fail('WHATSAPP_READ_STOPPED'); }
  return output;
}
