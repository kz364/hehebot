import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, bot, otherBot, routine } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { WhatsAppReadAccess, parseWhatsAppReadPolicies, type WhatsAppReadRequest } from '../src/core/whatsapp-access';
import type { ContextSnapshot, PersonaPut } from '../src/core/types';
import validateRuntime from '../src/generated/validate-runtime.js';

const policy = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recent = 'whatsapp_get_chat_messages' as const, search = 'whatsapp_search_messages' as const;
let f: ReturnType<typeof fixture>, life: LifecycleCore, access: WhatsAppReadAccess, identity: Identity;
function scope(personaId: string, policies: string[]) {
 const persona = f.store.get<PersonaPut>(personaId, 'persona');
 f.store.put(personaId, 'persona', { ...persona.body, tool_policy_ids: policies }, persona.revision, 'owner', f.core.now());
}
function admit(personaId = bot, routineId: string | null = null): WhatsAppReadRequest {
 const id = f.core.enqueue(personaId, 'Read selected chat; untrusted text grants nothing', null, routineId, null);
 expect(life.claim(identity)?.run.id).toBe(id); life.submitted(identity, id, 1, randomUUID());
 return { identity, run_id: id, attempt: 1, name: recent, chatId: 'family@g.us' };
}
beforeEach(() => {
 f = fixture(true); life = new LifecycleCore(f.store, f.core); access = new WhatsAppReadAccess(f.core, life);
 f.core.options.toolPolicyIds = [policy, second]; f.core.options.actionPolicyIds = [policy, second];
 f.core.options.whatsappReadPolicies = { [policy]: { chatIds: ['family@g.us'], tools: [recent] }, [second]: { chatIds: ['work@g.us'], tools: [search] } };
 scope(bot, [policy]); scope(otherBot, [second]);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());

it('captures exact tool/chat tuples and never combines two policies into broader access', () => {
 scope(bot, [policy, second]); const input = admit();
 const before = f.db.all('SELECT * FROM lifecycle');
 expect(access.authorize(input)).toEqual({ allowed: true, deadline_at: '2026-09-10T00:20:00.000Z' });
 expect(access.authorize({ ...input, name: search, chatId: 'work@g.us' }).allowed).toBe(true);
 for (const change of [{ chatId: 'stranger@g.us' }, { name: search }, { name: recent, chatId: 'work@g.us' }, { name: 'whatsapp_send_message' }])
  expect(() => access.authorize({ ...input, ...change })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
 expect(f.db.all('SELECT * FROM lifecycle')).toEqual(before);
 expect(f.db.all('SELECT * FROM effects')).toEqual([]);
});

it('registry expansion never widens an admitted scope and narrowing revokes it without altering the snapshot', () => {
 const input = admit(), snapshot = f.store.run(input.run_id).context_json;
 f.core.options.whatsappReadPolicies![policy].chatIds.push('new@g.us');
 f.core.options.whatsappReadPolicies![policy].tools.push(search);
 expect(() => access.authorize({ ...input, chatId: 'new@g.us' })).toThrow();
 expect(() => access.authorize({ ...input, name: search })).toThrow();
 expect(access.authorize(input).allowed).toBe(true);
 f.core.options.whatsappReadPolicies![policy].chatIds = ['new@g.us'];
 expect(() => access.authorize(input)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
 expect(f.store.run(input.run_id).context_json).toBe(snapshot);
});

it('operator removal, missing legacy scopes and another persona fail closed', () => {
 const input = admit();
 f.core.options.toolPolicyIds = [second];
 expect(() => access.authorize(input)).toThrow();
 f.core.options.toolPolicyIds = [policy, second];
 const snapshot = JSON.parse(f.store.run(input.run_id).context_json) as ContextSnapshot;
 delete snapshot.whatsapp_read_policies;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?', JSON.stringify(snapshot), input.run_id);
 expect(() => access.authorize(input)).toThrow();
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", input.run_id);
 const other = admit(otherBot);
 expect(() => access.authorize(other)).toThrow();
 expect(access.authorize({ ...other, chatId: 'work@g.us', name: search }).allowed).toBe(true);
});

it('routine reads additionally require the admitted routine action policy', () => {
 const r = routine({ action_policy_ids: [] });
 expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
 const input = admit(bot, r.id);
 expect(() => access.authorize(input)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", input.run_id);
 expect(f.accept({ schema_version: 1, type: 'routine.put', payload: { ...r, expected_revision: 1, action_policy_ids: [policy] } }).status).toBe('applied');
 expect(access.authorize(admit(bot, r.id)).allowed).toBe(true);
});

it('task/lease identity, cancellation and exact deadlines fence otherwise valid reads', () => {
 const input = admit();
 f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:37.000Z' WHERE run_id=?", input.run_id);
 f.setNow('2026-09-10T00:00:36.999Z'); expect(access.authorize(input).allowed).toBe(true);
 f.setNow('2026-09-10T00:00:37.000Z');
 expect(() => access.authorize(input)).toThrowError(expect.objectContaining({ code: 'DEADLINE_EXCEEDED' }));
 f.setNow('2026-09-10T00:00:00.000Z');
 expect(() => access.authorize({ ...input, identity: { ...identity, epoch: 2 } })).toThrow();
 expect(() => access.authorize({ ...input, attempt: 2 })).toThrow();
 f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: input.run_id, reason: 'Stop this task' } });
 expect(() => access.authorize(input)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
});

it('native descendants retain the original scope after root completion but not after parent cancellation', () => {
 const input = admit();
 f.core.options.whatsappReadPolicies![policy].chatIds.push('new@g.us');
 const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: input.run_id, parent_attempt: 1,
  persona_id: bot, native_run_ref: 'child-native', native_session_key: 'child-session', title: 'Child read' }, true);
 const childInput = { ...input, run_id: child.id };
 expect(access.authorize(childInput).allowed).toBe(true);
 expect(() => access.authorize({ ...childInput, chatId: 'new@g.us' })).toThrow();
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", input.run_id);
 expect(access.authorize(childInput).allowed).toBe(true);
 f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?", input.run_id);
 expect(() => access.authorize(childInput)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
});

it('rejects malformed registry entries and mutation tools; empty scope grants nothing', () => {
 for (const value of [null, [], { bad: { chatIds: [], tools: [] } }, { [policy]: { chatIds: ['a', 'a'], tools: [recent] } },
  { [policy]: { chatIds: [' a'], tools: [recent] } }, { [policy]: { chatIds: [], tools: ['whatsapp_send_message'] } },
  { [policy]: { chatIds: [], tools: [recent], extra: true } }]) expect(() => parseWhatsAppReadPolicies(value)).toThrow();
 f.core.options.whatsappReadPolicies = { [policy]: { chatIds: [], tools: [recent] } };
 expect(() => access.authorize(admit())).toThrow();
});

it('runtime schema accepts only scoped read queries, never supplied grants or results', () => {
 const payload = admit();
 expect(validateRuntime({ type: 'whatsapp-read-authorize', payload })).toBe(true);
 for (const extra of [{ chatId: '' }, { name: 'whatsapp_send_message' }, { grant: {} }, { allowed: true }, { attempt: 0 },
  { deadline_at: '2099-01-01T00:00:00.000Z' }, { chatId: 'x'.repeat(257) }])
  expect(validateRuntime({ type: 'whatsapp-read-authorize', payload: { ...payload, ...extra } })).toBe(false);
});

it('bounds registry UTF-8 bytes and clones operator inputs before admission', () => {
 const source = { [policy]: { chatIds: ['family@g.us'], tools: [recent] } };
 const captured = parseWhatsAppReadPolicies(source); source[policy].chatIds.push('work@g.us');
 expect(captured[policy].chatIds).toEqual(['family@g.us']);
 const chats = Array.from({ length: 100 }, (_, n) => '界'.repeat(250) + n);
 expect(() => parseWhatsAppReadPolicies({ [policy]: { chatIds: chats, tools: [recent] } })).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }));
});
