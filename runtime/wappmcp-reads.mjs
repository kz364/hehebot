// Host boundary for the source-inspected wappmcp 0.4.0 contract. No installation,
// pairing, tool registration or grant issuance occurs here.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const string = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cs}]/u.test(value);
const integer = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max;
const tools = ['whatsapp_get_chat_messages', 'whatsapp_search_messages'];

/** grant must come from the authenticated host's admitted task snapshot, never
 * model arguments or imported text. Caller owns current lease/revocation checks
 * and the one-installation MCP connection. This module grants no runtime access.
 */
export async function readWappMcp(grant, name, args, call) {
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
  let result;
  try { result = await call(name, { ...admitted }); }
  catch { fail('WHATSAPP_READ_FAILED'); }
  // Never pass upstream text/error/resource blocks through: only the checked
  // structured JSON crosses the boundary, without inferred complete coverage.
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
    return { chatId: admitted.chatId, messages: messages.map(({ id, body, timestamp }) => ({ id, body, timestamp })), coverage: 'unknown',
      ...(search ? { query: admitted.query, page } : {}) };
  } catch { fail('WHATSAPP_READ_INVALID'); }
}
