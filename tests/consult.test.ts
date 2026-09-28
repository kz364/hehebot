import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCommandBoundary } from '../src/core/agent-commands';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import type { ContextSnapshot, PersonaPut, RoomPut } from '../src/core/types';
import { bot, fixture, otherBot } from './helpers';
import validateRuntime from '../src/generated/validate-runtime.js';

// A8 consult (hehebot_ask_bot / bot.ask): a bot asks a bot outside the
// conversation. bot = Chief of Staff (seeded can_ask: Inbox Triage, Travel),
// otherBot = Inbox Triage, travel = Travel.
const travel = '33333333-3333-4333-8333-333333333333';
const identity: Identity = { epoch: 1, boot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const FAR_FUTURE = '2026-09-10T23:00:00.000Z';
let f: ReturnType<typeof fixture>, boundary: AgentCommandBoundary, life: LifecycleCore;

function running(runId: string) {
  f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?", runId);
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running',?,?)",
    runId, `${runId}:1`, identity.boot_id, `native-${runId}`, FAR_FUTURE, f.core.now());
}
function coordinator(personaId: string, extra: Partial<ContextSnapshot> = {}) {
  const id = randomUUID(), now = f.core.now();
  const context = { ...f.core.context(personaId, 'Coordinator turn', null, extra.room_id ?? null), ...extra };
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'coordinator','queued',0,?,?)", id, personaId, JSON.stringify(context), now, now);
  running(id);
  return id;
}
const ask = (runId: string, botId: string, question: string) => boundary.accept({ identity, run_id: runId, attempt: 1, idempotency_key: randomUUID(),
  command: { schema_version: 1, type: 'bot.ask', payload: { bot_id: botId, question } } });
const run = (id: string) => f.db.all<{ persona_id: string; role: string; parent_run_id: string | null; status: string; context_json: string }>(
  'SELECT persona_id,role,parent_run_id,status,context_json FROM runs WHERE id=?', id)[0];
const contextOf = (id: string) => JSON.parse(run(id).context_json) as ContextSnapshot;
const botMessages = (conversationId: string) => f.db.all<{ actor_id: string; payload_json: string }>(
  "SELECT actor_id,payload_json FROM events WHERE conversation_id=? AND type='bot.message' ORDER BY sequence", conversationId).map(row => ({ actor: row.actor_id, ...JSON.parse(row.payload_json) }));
const latestCoordinator = (personaId: string) => f.db.all<{ id: string; context_json: string }>(
  "SELECT id,context_json FROM runs WHERE persona_id=? AND role='coordinator' AND status='queued' ORDER BY created_at DESC,rowid DESC LIMIT 1", personaId)[0];
function allowAsk(personaId: string, canAsk: string[]) {
  const existing = f.store.get<PersonaPut>(personaId, 'persona');
  f.store.put(personaId, 'persona', { ...existing.body, can_ask: canAsk }, existing.revision, 'owner', f.core.now());
}

beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core); boundary = new AgentCommandBoundary(f.core, life);
  f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='READY',lease_until=?", identity.boot_id, FAR_FUTURE);
});
afterEach(() => f.close());

describe('bot.ask consult', () => {
  it('passes the Worker runtime RPC schema (the agent-command envelope lists bot.ask)', () => {
    expect(validateRuntime({ type: 'agent-command', payload: { identity, run_id: randomUUID(), attempt: 1, idempotency_key: randomUUID(),
      command: { schema_version: 1, type: 'bot.ask', payload: { bot_id: travel, question: 'Q?' } } } })).toBe(true);
  });
  it('runs the target bot in the background and wakes the asker with the answer, all collapsed for the owner', () => {
    const cos = coordinator(bot);
    const receipt = ask(cos, travel, 'Which airline does the owner prefer?');
    expect(receipt.status).toBe('applied');
    const consultId = receipt.resource_id!;
    expect(run(consultId)).toMatchObject({ persona_id: travel, role: 'background', parent_run_id: cos, status: 'queued' });
    expect(contextOf(consultId).consult).toMatchObject({ from_persona_id: bot, from_run_id: cos, conversation_id: bot, depth: 1, chain: [bot, travel] });
    expect(contextOf(consultId).instruction).toBe('Chief of Staff asks: Which airline does the owner prefer?');
    expect(botMessages(bot)).toEqual([expect.objectContaining({ actor: bot, text: '@Travel Which airline does the owner prefer?', audience: 'bots' })]);

    running(consultId);
    life.complete(identity, consultId, 1, { status: 'completed', text: 'Singapore Airlines, aisle seat.' });
    expect(botMessages(bot).at(-1)).toMatchObject({ actor: travel, text: 'Singapore Airlines, aisle seat.', audience: 'bots' });
    expect(botMessages(travel)).toEqual([]);
    const wake = latestCoordinator(bot);
    const wakeContext = JSON.parse(wake.context_json) as ContextSnapshot;
    expect(wakeContext.instruction).toContain('Travel answered your question "Which airline does the owner prefer?"');
    expect(wakeContext.instruction).toContain('Singapore Airlines, aisle seat.');
    expect(wakeContext).toMatchObject({ causal_depth: 1, consult_root: cos });
    expect(f.db.all("SELECT id FROM events WHERE type='task.event'")).toEqual([]);
  });

  it('does not post the answer twice when the coordinator inbox relays task results', () => {
    f.core.options.coordinatorInbox = true;
    const consultId = ask(coordinator(bot), travel, 'Q?').resource_id!;
    running(consultId);
    life.complete(identity, consultId, 1, { status: 'completed', text: 'A.' });
    expect(botMessages(bot).filter(message => message.actor === travel).map(message => message.text)).toEqual(['A.']);
  });

  it('refuses asks outside the allowlist, to itself, to a room member, and from an ordinary task', () => {
    expect(ask(coordinator(otherBot), travel, 'Q?').error?.code).toBe('FORBIDDEN');
    allowAsk(bot, [bot, travel]);
    expect(ask(coordinator(bot), bot, 'Q?').error?.code).toBe('INVALID_INPUT');
    const room: RoomPut = { id: randomUUID(), expected_revision: 0, name: 'Trip', member_ids: [bot, travel], default_responder_id: bot };
    expect(f.accept({ schema_version: 1, type: 'room.put', payload: room }).status).toBe('applied');
    expect(ask(coordinator(bot, { room_id: room.id }), travel, 'Q?').error?.code).toBe('INVALID_INPUT');
    const cos = coordinator(bot);
    const task = boundary.accept({ identity, run_id: cos, attempt: 1, idempotency_key: randomUUID(),
      command: { schema_version: 1, type: 'task.start', payload: { title: 'T', brief: 'B' } } }).resource_id!;
    running(task);
    expect(() => ask(task, travel, 'Q?')).toThrow(/may not ask/);
  });

  it('bounds asks per turn, per owner request, and by depth', () => {
    const cos = coordinator(bot);
    expect(ask(cos, travel, 'one').status).toBe('applied');
    expect(ask(cos, otherBot, 'two').status).toBe('applied');
    expect(ask(cos, travel, 'three').error?.code).toBe('DEADLINE_EXCEEDED');
    // A later wake of the same request shares its three-ask budget.
    const wake = coordinator(bot, { consult_root: cos });
    expect(ask(wake, travel, 'four').status).toBe('applied');
    expect(ask(wake, otherBot, 'five').error?.code).toBe('DEADLINE_EXCEEDED');

    allowAsk(travel, [otherBot, bot]);
    allowAsk(otherBot, [travel]);
    const first = ask(coordinator(bot), travel, 'Plan the trip').resource_id!;
    running(first);
    // Asking back up the chain is allowed; the budgets bound it.
    expect(ask(first, bot, 'Window or aisle?').status).toBe('applied');
    const second = ask(first, otherBot, 'Any booking emails?').resource_id!;
    expect(contextOf(second).consult).toMatchObject({ depth: 2, chain: [bot, travel, otherBot], conversation_id: bot });
    running(second);
    const whatsapp = '44444444-4444-4444-8444-444444444444';
    expect(f.accept({ schema_version: 1, type: 'persona.put', payload: { id: whatsapp, expected_revision: 0, name: 'WhatsApp', instructions: 'W', tool_policy_ids: [], archived: false } }).status).toBe('applied');
    allowAsk(otherBot, [travel, whatsapp]);
    expect(ask(second, '44444444-4444-4444-8444-444444444444', 'deeper').error?.code).toBe('DEADLINE_EXCEEDED');
  });

  it('a consulted bot that asked further continues its own answer before the original asker is woken', () => {
    allowAsk(travel, [otherBot]);
    const cos = coordinator(bot);
    const first = ask(cos, travel, 'Plan the trip').resource_id!;
    running(first);
    const second = ask(first, otherBot, 'Any booking emails?').resource_id!;
    life.complete(identity, first, 1, { status: 'completed', text: '' });
    running(second);
    life.complete(identity, second, 1, { status: 'completed', text: 'Flight SQ 947 on the 3rd.' });
    const continuation = f.db.all<{ id: string }>("SELECT id FROM runs WHERE persona_id=? AND json_extract(context_json,'$.consult.continuation')=1", travel)[0].id;
    expect(run(continuation)).toMatchObject({ parent_run_id: cos, status: 'queued' });
    expect(contextOf(continuation).instruction).toContain('Flight SQ 947 on the 3rd.');
    running(continuation);
    life.complete(identity, continuation, 1, { status: 'completed', text: 'Fly SQ 947 on the 3rd.' });
    expect(JSON.parse(latestCoordinator(bot).context_json).instruction).toContain('Fly SQ 947 on the 3rd.');
  });

  it('in a room, only a bot outside the room is asked, and the answer comes back as the next room turn', () => {
    f.core.options.roomTurns = true;
    const room: RoomPut = { id: randomUUID(), expected_revision: 0, name: 'Inbox', member_ids: [bot, otherBot], default_responder_id: bot };
    f.accept({ schema_version: 1, type: 'room.put', payload: room });
    f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: room.id, text: 'When do I fly?' } });
    const turn = f.db.all<{ id: string }>('SELECT id FROM runs WHERE persona_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', bot)[0].id;
    running(turn);
    expect(ask(turn, otherBot, 'Q?').error?.code).toBe('INVALID_INPUT');
    const consultId = ask(turn, travel, 'When does the owner fly?').resource_id!;
    expect(contextOf(consultId).consult?.conversation_id).toBe(room.id);
    life.complete(identity, turn, 1, { status: 'completed', text: '' });
    running(consultId);
    life.complete(identity, consultId, 1, { status: 'completed', text: 'On the 3rd.' });
    expect(botMessages(room.id).filter(message => message.actor === travel)).toEqual([expect.objectContaining({ text: 'On the 3rd.', audience: 'bots' })]);
    const next = f.db.all<{ context_json: string }>("SELECT context_json FROM runs WHERE persona_id=? AND status='queued' ORDER BY created_at DESC,rowid DESC LIMIT 1", bot)[0];
    const context = JSON.parse(next.context_json) as ContextSnapshot;
    expect(context.room_turn).toMatchObject({ room_id: room.id, member_id: bot, hop: 1 });
    expect(context.instruction).toContain('On the 3rd.');
  });
});
