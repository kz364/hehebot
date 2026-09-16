import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
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

test('trusted task deadline caps the read without extending a shorter operation timeout', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  for (const [timeoutMs, remaining, cap] of [[100, 37, 37], [19, 83, 19]]) {
    let release, signal, stopped = false;
    const options = { timeoutMs, deadlineAt: new Date(Date.now() + remaining).toISOString() };
    const result = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, (_, __, input) => {
      signal = input.signal; options.deadlineAt = new Date(Date.now() + 99999).toISOString();
      return new Promise(resolve => { release = resolve; });
    }, options);
    const checked = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' }).then(() => { stopped = true; });
    await Promise.resolve(); t.mock.timers.tick(cap - 1); await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, false); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await checked; assert.equal(signal.aborted, true);
    release(envelope([message()])); await new Promise(resolve => setImmediate(resolve));
  }
});

test('invalid or expired task deadlines deny I/O, including expiry before the dispatch microtask', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100 });
  const call = () => assert.fail('expired or invalid read reached upstream');
  for (const deadlineAt of [null, undefined, 123, {}, Symbol('private'), 'invalid', '1970-01-01T00:00:01Z', '1970-01-01T01:00:01.000+01:00']) {
    await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, call, { deadlineAt }), { code: 'WHATSAPP_READ_DENIED' });
  }
  for (const end of [99, 100]) {
    await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, call, { deadlineAt: new Date(end).toISOString() }), { code: 'WHATSAPP_READ_STOPPED' });
  }
  const result = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, call, { deadlineAt: new Date(101).toISOString() });
  t.mock.timers.setTime(101);
  await assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
});

test('two-minute deadline stops exactly and late upstream completion cannot return data', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const controller = new AbortController(); let release, upstreamSignal, calls = 0, stopped = false;
  const result = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, (_, __, { signal }) => {
    calls++; upstreamSignal = signal; return new Promise(resolve => { release = resolve; });
  }, { signal: controller.signal });
  const checked = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' }).then(() => { stopped = true; });
  await Promise.resolve();
  t.mock.timers.tick(119999); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false); assert.equal(upstreamSignal.aborted, false);
  t.mock.timers.tick(1); await checked;
  assert.equal(upstreamSignal.aborted, true); assert.equal(calls, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  release(envelope([message()])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('pre-call cancellation denies I/O; in-flight cancellation signals upstream and suppresses late failures', async () => {
  const controller = new AbortController(); controller.abort('PRIVATE_REASON'); let calls = 0;
  await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, () => { calls++; }, { signal: controller.signal }),
    { code: 'WHATSAPP_READ_STOPPED', message: 'WHATSAPP_READ_STOPPED' });
  assert.equal(calls, 0);
  const active = new AbortController(); let rejectUpstream, signal;
  const result = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, (_, __, options) => {
    signal = options.signal; return new Promise((_, reject) => { rejectUpstream = reject; });
  }, { signal: active.signal, timeoutMs: 1000 });
  const checked = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
  await Promise.resolve(); active.abort('PRIVATE_REASON'); await checked;
  assert.equal(signal.aborted, true); assert.equal(getEventListeners(active.signal, 'abort').length, 0);
  rejectUpstream(Error('PRIVATE_ERROR')); await new Promise(resolve => setImmediate(resolve));
});

test('invalid timeout options never call upstream and successful reads remove listeners', async () => {
  for (const options of [null, { timeoutMs: 0 }, { timeoutMs: null }, { timeoutMs: 120001 }, { timeoutMs: 1.5 }, { signal: {} }, { extra: true }]) {
    await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, () => assert.fail('invalid call'), options),
      { code: 'WHATSAPP_READ_DENIED' });
  }
  const controller = new AbortController();
  await readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async () => envelope([]), { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('an expired result is refused even before the timer callback runs', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  let upstreamSignal;
  await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async (_, __, { signal }) => {
    upstreamSignal = signal; t.mock.timers.setTime(37); return envelope([message()]);
  }, { timeoutMs: 37 }), { code: 'WHATSAPP_READ_STOPPED' });
  assert.equal(upstreamSignal.aborted, true);
});

test('upstream cannot retarget the admitted request; valid maximum bound is accepted', async () => {
  const args = { chatId: 'family@g.us', limit: 100 }, scope = grant();
  const result = await readWappMcp(scope, recent, args, async (_, forwarded) => {
    forwarded.chatId = 'other@g.us'; args.chatId = 'other@g.us'; scope.chatIds.push('other@g.us');
    return envelope(Array.from({ length: 100 }, (_, i) => message(`id-${i}`)));
  });
  assert.equal(result.chatId, 'family@g.us'); assert.equal(result.messages.length, 100);
});

test('host authority is checked before I/O and again before returning chat data', async () => {
  const events = [], options = { authorize: async (request, { signal }) => {
    assert.deepEqual(request, { name: recent, chatId: 'family@g.us' });
    assert.equal(Object.isFrozen(request), true); assert.equal(signal.aborted, false);
    events.push('authorize'); return true;
  } };
  const output = await readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async () => {
    events.push('read'); options.authorize = () => assert.fail('callback replaced');
    return envelope([message()]);
  }, options);
  assert.deepEqual(events, ['authorize', 'read', 'authorize']);
  assert.equal(output.messages[0].id, 'msg-43');
});

test('denied, malformed and failed host authorization never exposes data or host errors', async () => {
  for (const decision of [false, null, undefined, {}, 'true', 1, Error('PRIVATE_CUSTODY')]) {
    for (const denyAt of [1, 2]) {
      let checks = 0, calls = 0, signal;
      await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async () => {
        calls++; return envelope([message()]);
      }, { authorize: async (_, options) => {
        signal = options.signal; checks++;
        if (checks !== denyAt) return true;
        if (decision instanceof Error) throw decision;
        return decision;
      } }), { code: 'WHATSAPP_READ_DENIED', message: 'WHATSAPP_READ_DENIED' });
      assert.equal(checks, denyAt); assert.equal(calls, denyAt - 1); assert.equal(signal.aborted, true);
    }
  }
  for (const authorize of [null, true, 'PRIVATE', undefined]) {
    await assert.rejects(readWappMcp(grant(), recent, { chatId: 'family@g.us' }, () => assert.fail('invalid authority'),
      { authorize }), { code: 'WHATSAPP_READ_DENIED' });
  }
});

test('each host check is bounded; late authorization cannot dispatch or release a result', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  for (const heldCheck of [1, 2]) {
    let checks = 0, calls = 0, release, signal;
    const controller = new AbortController();
    const result = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, async () => {
      calls++; return envelope([message()]);
    }, { signal: controller.signal, timeoutMs: 37, authorize: (_, options) => {
      checks++; signal = options.signal;
      return checks === heldCheck ? new Promise(resolve => { release = resolve; }) : true;
    } });
    const checked = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(checks, heldCheck); t.mock.timers.tick(37); await checked;
    assert.equal(signal.aborted, true); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    release(true); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, heldCheck - 1); assert.equal(checks, heldCheck);
  }
});

test('one revoked task does not cancel an independently authorized read', async () => {
  let release, checks = 0;
  const first = readWappMcp(grant(), recent, { chatId: 'family@g.us' }, () => new Promise(resolve => { release = resolve; }),
    { authorize: () => ++checks === 1 });
  const denied = assert.rejects(first, { code: 'WHATSAPP_READ_DENIED' });
  await new Promise(resolve => setImmediate(resolve));
  const second = await readWappMcp({ chatIds: ['work@g.us'], tools: [recent] }, recent, { chatId: 'work@g.us' },
    async () => envelope([message('work-11', 'work@g.us')]), { authorize: () => true });
  release(envelope([message()])); await denied;
  assert.equal(second.chatId, 'work@g.us'); assert.equal(second.messages[0].id, 'work-11');
});
