import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture, bot, otherBot } from './helpers';
import { BotMessages } from '../src/core/bot-messages';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import type { Command, ContextSnapshot, RoomPut, RoomTurnEnvelope } from '../src/core/types';

// V9 (ARCHITECTURE_V2 A8): bounded, attributed turn-taking in group rooms.
// Exercises the ControlCore/LifecycleCore layer directly (same level as
// tests/task-tools.test.ts), driving the scheduler through message.send,
// hehebot_send_message (BotMessages.post), hehebot_pass_turn (RoomTurns.pass)
// and lifecycle.complete()'s room-turn hook -- not a scripted-model harness.

const third = '33333333-3333-4333-8333-333333333333';
const identity: Identity = { epoch: 1, boot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const FAR_FUTURE = '2026-09-10T23:00:00.000Z';
let f: ReturnType<typeof fixture>, life: LifecycleCore;

function room(memberIds = [bot, otherBot, third], defaultResponder = bot) {
  const payload: RoomPut = { id: randomUUID(), expected_revision: 0, name: 'Synthetic room', member_ids: memberIds, default_responder_id: defaultResponder };
  const receipt = f.accept({ schema_version: 1, type: 'room.put', payload });
  expect(receipt.status).toBe('applied');
  return payload;
}
const sendToRoom = (roomId: string, text: string) =>
  f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: roomId, text } } as Command);

function runOf(personaId: string) {
  return f.db.all<{ id: string; context_json: string; status: string }>(
    "SELECT id,context_json,status FROM runs WHERE persona_id=? AND status IN ('queued','running') ORDER BY created_at DESC,id DESC LIMIT 1", personaId)[0];
}
function envelope(run: { context_json: string }): RoomTurnEnvelope {
  return (JSON.parse(run.context_json) as ContextSnapshot).room_turn!;
}
/** Advances a queued room-turn run to 'running' with a real attempt, the same
 * way tests/task-tools.test.ts's runTask bypasses the native claim() queue. */
function admitRunning(runId: string) {
  const now = f.core.now();
  f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?", runId);
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running',?,?)",
    runId, `${runId}:1`, identity.boot_id, `native-${runId}`, FAR_FUTURE, now);
}
const sendMessage = (runId: string, text: string) =>
  new BotMessages(f.store, () => f.core.now(), randomUUID).post(identity, { run_id: runId, attempt: 1, message_key: `${runId}:1:${randomUUID()}`, text }, life);
const passTurn = (runId: string) => f.core.roomTurns.pass(identity, { run_id: runId, attempt: 1 }, life);
const finish = (runId: string, status: 'completed' | 'failed' | 'cancelled', error_code?: string) =>
  life.complete(identity, runId, 1, { status, text: '', ...(error_code ? { error_code } : {}) });
function turnEvents(roomId: string) {
  return f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE conversation_id=? AND type='room.turn' ORDER BY sequence", roomId)
    .map(row => JSON.parse(row.payload_json));
}
function busy(roomId: string) { return f.db.all('SELECT id FROM room_turn_log WHERE room_id=? AND outcome IS NULL', roomId).length > 0; }

beforeEach(() => {
  f = fixture(true, { roomTurns: true }); life = new LifecycleCore(f.store, f.core);
  // Admits identity's boot/epoch as the current executor (mirrors
  // tests/task-tools.test.ts's admitCoordinator): authorizeAttempt()/pass()
  // both check this via LifecycleCore.identity() before touching an attempt.
  f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='READY',lease_until=?", identity.boot_id, FAR_FUTURE);
});
afterEach(() => f.close());

describe('V9 room turn scheduler (ARCHITECTURE_V2 A8)', () => {
  it('schedules the default responder with a bounded envelope, then frees the room once SENT settles', () => {
    const r = room();
    const receipt = sendToRoom(r.id, 'Owner request'); expect(receipt.status).toBe('applied');
    const run = runOf(bot); expect(run.status).toBe('queued');
    const env = envelope(run);
    expect(env).toMatchObject({ room_id: r.id, member_id: bot, hop: 0, deadline_ms: 120000, is_winding_down: false });
    expect(env.peers.map(p => p.id).sort()).toEqual([otherBot, third].sort());
    expect(busy(r.id)).toBe(true);
    admitRunning(run.id); sendMessage(run.id, 'Acknowledged, no follow-up needed.'); finish(run.id, 'completed');
    expect(busy(r.id)).toBe(false);
    const events = turnEvents(r.id);
    expect(events).toEqual([
      { log_id: expect.any(String), member_id: bot, hop: 0, root_cause_id: env.root_cause_id, phase: 'started' },
      { log_id: expect.any(String), member_id: bot, hop: 0, root_cause_id: env.root_cause_id, phase: 'settled', outcome: 'SENT' },
    ]);
    // Room targeting cannot be spoofed: the room-turn run's bot.message lands
    // in the room conversation, read only from the run's own admitted context.
    const message = f.db.all<{ conversation_id: string }>("SELECT conversation_id FROM events WHERE type='bot.message' AND cause_id=?", run.id)[0];
    expect(message.conversation_id).toBe(r.id);
  });

  it('serializes turns within a room: a second owner message while busy queues and starts once the first settles', () => {
    const r = room();
    sendToRoom(r.id, 'First'); const first = runOf(bot);
    const before = f.db.all('SELECT id FROM runs').length;
    sendToRoom(r.id, 'Second, while busy');
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(before); // No second run yet.
    expect(f.db.all('SELECT * FROM room_turn_pending')).toMatchObject([{ room_id: r.id, kind: 'owner', text: 'Second, while busy' }]);
    admitRunning(first.id); passTurn(first.id); finish(first.id, 'completed');
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(before + 1);
    expect(f.db.all('SELECT * FROM room_turn_pending')).toEqual([]);
    const second = runOf(bot); expect(second.id).not.toBe(first.id);
    expect(envelope(second)).toMatchObject({ hop: 0, member_id: bot });
  });

  it('hands off to a member mentioned by name, incrementing hop and keeping the same root_cause_id', () => {
    const r = room();
    sendToRoom(r.id, 'Owner request'); const first = runOf(bot);
    const cause = envelope(first).root_cause_id;
    admitRunning(first.id); sendMessage(first.id, 'Inbox Triage, can you check this?'); finish(first.id, 'completed');
    const next = runOf(otherBot);
    expect(envelope(next)).toMatchObject({ member_id: otherBot, hop: 1, root_cause_id: cause, is_winding_down: false });
  });

  it('fans out to at most 2 mentioned members, sequencing the second after the first settles', () => {
    const r = room();
    sendToRoom(r.id, 'Owner request'); const first = runOf(bot);
    const cause = envelope(first).root_cause_id;
    admitRunning(first.id); sendMessage(first.id, 'Inbox Triage and Travel, please both weigh in.'); finish(first.id, 'completed');
    const second = runOf(otherBot); expect(envelope(second)).toMatchObject({ hop: 1, root_cause_id: cause });
    expect(f.db.all('SELECT * FROM room_turn_pending')).toMatchObject([{ kind: 'candidate', member_id: third }]);
    admitRunning(second.id); passTurn(second.id); finish(second.id, 'completed');
    const thirdRun = runOf(third); expect(envelope(thirdRun)).toMatchObject({ hop: 1, root_cause_id: cause });
    expect(f.db.all('SELECT * FROM room_turn_pending')).toEqual([]);
  });

  it('enforces the 3-contribution cap even when fan-out reaches it before hop depth 2', () => {
    const r = room();
    sendToRoom(r.id, 'Owner request'); const first = runOf(bot); // contribution 1 (hop 0)
    const cause = envelope(first).root_cause_id;
    admitRunning(first.id); sendMessage(first.id, 'Inbox Triage and Travel, weigh in.'); finish(first.id, 'completed');
    const second = runOf(otherBot); // contribution 2 (hop 1)
    admitRunning(second.id); sendMessage(second.id, 'On it.'); finish(second.id, 'completed');
    expect(f.db.all("SELECT COUNT(*) AS n FROM room_turn_log WHERE root_cause_id=? AND outcome='SENT'", cause)[0]).toEqual({ n: 2 });
    const thirdRun = runOf(third); expect(envelope(thirdRun)).toMatchObject({ hop: 1, is_winding_down: true }); // 3rd would hit the cap.
    admitRunning(thirdRun.id); sendMessage(thirdRun.id, 'Chief of Staff, one more thing.'); finish(thirdRun.id, 'completed');
    // The cap (3) is now reached; a further mention is SKIPPED, not scheduled.
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(3);
    const log = f.db.all<{ member_id: string; outcome: string; hop: number }>('SELECT member_id,outcome,hop FROM room_turn_log ORDER BY created_at');
    expect(log.filter(x => x.outcome === 'SENT')).toHaveLength(3);
    expect(log.at(-1)).toMatchObject({ member_id: bot, outcome: 'SKIPPED', hop: 2 });
    expect(busy(r.id)).toBe(false);
  });

  it('enforces hop depth 2 in a two-member ping-pong room', () => {
    const r = room([bot, otherBot], bot);
    sendToRoom(r.id, 'Owner request'); let run = runOf(bot);
    for (let hop = 0; hop < 3; hop++) {
      const expectedNext = hop % 2 === 0 ? otherBot : bot;
      admitRunning(run.id); sendMessage(run.id, hop % 2 === 0 ? 'Inbox Triage, your turn.' : 'Chief of Staff, back to you.'); finish(run.id, 'completed');
      if (hop < 2) { run = runOf(expectedNext); expect(envelope(run).hop).toBe(hop + 1); }
    }
    // hop 2 (the 3rd turn) was already is_winding_down; its own mention is
    // skipped because hop 3 exceeds MAX_HOP, independent of the contribution cap.
    const log = f.db.all<{ outcome: string; hop: number }>('SELECT outcome,hop FROM room_turn_log ORDER BY created_at');
    expect(log.map(x => x.outcome)).toEqual(['SENT', 'SENT', 'SENT', 'SKIPPED']);
    expect(log.at(-1)!.hop).toBe(3);
  });

  it('records PASS, TIMEOUT and ERROR outcomes and never auto-retries a room-turn run', () => {
    const r = room();
    sendToRoom(r.id, 'Owner request'); const passRun = runOf(bot);
    admitRunning(passRun.id); passTurn(passRun.id); finish(passRun.id, 'completed');
    expect(f.db.all('SELECT outcome FROM room_turn_log WHERE run_id=?', passRun.id)).toEqual([{ outcome: 'PASS' }]);
    expect(busy(r.id)).toBe(false);

    sendToRoom(r.id, 'Second owner request'); const timeoutRun = runOf(bot);
    admitRunning(timeoutRun.id); finish(timeoutRun.id, 'failed', 'DEADLINE_EXCEEDED');
    expect(f.db.all('SELECT outcome FROM room_turn_log WHERE run_id=?', timeoutRun.id)).toEqual([{ outcome: 'TIMEOUT' }]);
    expect(f.store.run(timeoutRun.id).status).toBe('failed'); // Not requeued 'waiting' by the generic retry backoff.
    expect(busy(r.id)).toBe(false);

    sendToRoom(r.id, 'Third owner request'); const errorRun = runOf(bot);
    admitRunning(errorRun.id); finish(errorRun.id, 'failed', 'NATIVE_TOOL_ERROR');
    expect(f.db.all('SELECT outcome FROM room_turn_log WHERE run_id=?', errorRun.id)).toEqual([{ outcome: 'ERROR' }]);
    expect(busy(r.id)).toBe(false);
  });

  it('is independent across rooms: a busy room does not block scheduling in another room', () => {
    const r1 = room([bot, otherBot], bot), r2 = room([bot, otherBot], otherBot);
    sendToRoom(r1.id, 'Room 1 request'); const run1 = runOf(bot);
    expect(busy(r1.id)).toBe(true); expect(busy(r2.id)).toBe(false);
    sendToRoom(r2.id, 'Room 2 request');
    const run2 = f.db.all<{ id: string; context_json: string }>(
      "SELECT id,context_json FROM runs WHERE persona_id=? AND status='queued' ORDER BY created_at DESC LIMIT 1", otherBot)[0];
    expect(envelope(run2)).toMatchObject({ room_id: r2.id, member_id: otherBot, hop: 0 });
    expect(busy(r2.id)).toBe(true);
    admitRunning(run1.id); passTurn(run1.id); finish(run1.id, 'completed');
    expect(busy(r1.id)).toBe(false); expect(busy(r2.id)).toBe(true); // Unaffected by room 1 settling.
  });

  it('passive room context updates still cause zero wake and no run, with the scheduler flag on', () => {
    const r = room();
    const before = f.db.all('SELECT queue_sequence FROM lifecycle')[0];
    expect(f.accept({ schema_version: 1, type: 'room.publish', payload: {
      room_id: r.id, kind: 'context_update', recipient_ids: [bot], text: 'Synthetic update', references: [], cause_id: randomUUID(),
    } }).status).toBe('applied');
    expect(f.db.all('SELECT * FROM runs')).toHaveLength(0);
    expect(f.db.all('SELECT queue_sequence FROM lifecycle')[0]).toEqual(before);
  });

  it('hehebot_pass_turn is refused outside a scheduled room turn', () => {
    const receipt = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Direct message' } });
    const runId = receipt.resource_id!;
    f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?", runId);
    f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running',?,?)",
      runId, `${runId}:1`, identity.boot_id, `native-${runId}`, FAR_FUTURE, f.core.now());
    expect(() => passTurn(runId)).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }));
  });
});
