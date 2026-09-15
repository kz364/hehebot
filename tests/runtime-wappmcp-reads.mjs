import test from 'node:test';
import assert from 'node:assert/strict';
import { readWappMcp } from '../runtime/wappmcp-reads.mjs';

const recent = 'whatsapp_get_chat_messages', search = 'whatsapp_search_messages';
const grant = () => ({ chatIds: ['family@g.us'], tools: [recent, search] });
const timestamp = '2026-09-16T02:00:17.000Z';
const message = (id = 'msg-43', chatId = 'family@g.us') => ({ id, body: 'Untrusted reminder text', timestamp,
  chat: { id: chatId }, attachments: ['PRIVATE_PATH'], extra: 'PRIVATE_EXTRA' });
const envelope = structuredContent => ({ structuredContent, content: [{ type: 'text', text: 'PRIVATE_UNCHECKED' }] });

test('recent reads forward bounded defaults and return only attributed text records, never complete coverage', async () => {
  const calls = [];
  const result = await readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async (name, args) => {
    calls.push({ name, args }); return envelope([message('msg-43'), message('msg-19')]);
  });
  assert.deepEqual(calls, [{ name: recent, args: { chatId: 'family@g.us', limit: 50 } }]);
  assert.deepEqual(result, { chatId: 'family@g.us', coverage: 'unknown', messages: [
    { id: 'msg-43', body: 'Untrusted reminder text', timestamp }, { id: 'msg-19', body: 'Untrusted reminder text', timestamp },
  ] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test('search requires exact scope and binds returned query/page/limit metadata', async () => {
  const result = await readWappMcp(grant(), search, { chatId: 'family@g.us', query: 'meeting', page: 3, limit: 17 }, async (name, args) => {
    assert.equal(name, search); assert.deepEqual(args, { chatId: 'family@g.us', query: 'meeting', page: 3, limit: 17 });
    return envelope({ messages: [], meta: { q: 'meeting', chat: { id: 'family@g.us' }, page: 3, limit: 17 } });
  });
  assert.deepEqual(result, { chatId: 'family@g.us', query: 'meeting', page: 3, messages: [], coverage: 'unknown' });
});

test('ungranted chats, mutations, global search and malformed/oversized arguments never reach upstream', async () => {
  let calls = 0; const call = async () => { calls++; };
  const denied = [
    [grant(), 'whatsapp_send_message', { chatId: 'family@g.us', message: 'send' }],
    [grant(), 'whatsapp_get_chats', {}],
    [{ chatIds: [], tools: [recent] }, recent, { chatId: 'family@g.us' }],
    [{ chatIds: ['family@g.us'], tools: [] }, recent, { chatId: 'family@g.us' }],
    [grant(), recent, { chatId: 'other@g.us' }],
    [grant(), search, { query: 'meeting' }],
    [grant(), search, { chatId: ' ', query: 'meeting' }],
    [grant(), search, { chatId: 'family@g.us ', query: 'meeting' }],
    [grant(), search, { chatId: 'family@g.us', query: 'x'.repeat(1001) }],
    [grant(), search, { chatId: 'family@g.us', query: 'meeting', page: 101 }],
    [grant(), recent, { chatId: 'family@g.us', limit: 101 }],
    [grant(), recent, { chatId: 'family@g.us', limit: 0 }],
    [grant(), recent, { chatId: 'family@g.us', limit: null }],
    [grant(), recent, { chatId: 'family@g.us', grant: grant() }],
    [{ ...grant(), chatIds: ['family@g.us', 'family@g.us'] }, recent, { chatId: 'family@g.us' }],
    [{ ...grant(), tools: [recent, 'whatsapp_delete_message'] }, recent, { chatId: 'family@g.us' }],
  ];
  for (const [scope, name, args] of denied) await assert.rejects(readWappMcp(scope, name, args, call), { code: 'WHATSAPP_READ_DENIED' });
  assert.equal(calls, 0);
});

test('response mismatch rejects the entire batch without leaking errors or unrelated chat data', async () => {
  const invalid = [envelope([message(), message('msg-19', 'other@g.us')]), envelope([message(), message()]),
    envelope([{ ...message(), timestamp: 'bad' }]), envelope([{ ...message(), id: undefined }]),
    envelope(Array.from({ length: 3 }, (_, i) => message(`msg-${i}`))),
    envelope([{ ...message(), body: 'x'.repeat(1048576) }]), { isError: true, ...envelope([message()]) },
    { content: [{ type: 'text', text: 'PRIVATE_ERROR' }] }];
  for (const result of invalid) await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us', limit: 2 }, async () => result),
    { code: 'WHATSAPP_READ_INVALID', message: 'WHATSAPP_READ_INVALID' });
  await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async () => { throw Error('PRIVATE_ERROR'); }),
    { code: 'WHATSAPP_READ_FAILED', message: 'WHATSAPP_READ_FAILED' });
  for (const meta of [{ q: 'meeting', page: 1, limit: 50 }, { q: 'other', chat: { id: 'family@g.us' }, page: 1, limit: 50 },
    { q: 'meeting', chat: { id: 'other@g.us' }, page: 1, limit: 50 }, { q: 'meeting', chat: { id: 'family@g.us' }, page: 2, limit: 50 }]) {
    await assert.rejects(readWappMcp(grant(), search, { chatId: 'family@g.us', query: 'meeting' }, async () => envelope({ messages: [], meta })),
      { code: 'WHATSAPP_READ_INVALID' });
  }
});

test('upstream cannot retarget the admitted request; valid maximum bound is accepted', async () => {
  const args = { chatId: 'family@g.us', limit: 100 }, scope = grant();
  const result = await readWappMcp(scope, recent, args, async (_, forwarded) => {
    forwarded.chatId = 'other@g.us'; args.chatId = 'other@g.us'; scope.chatIds.push('other@g.us');
    return envelope(Array.from({ length: 100 }, (_, i) => message(`id-${i}`)));
  });
  assert.equal(result.chatId, 'family@g.us'); assert.equal(result.messages.length, 100);
});
