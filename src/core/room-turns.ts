import type { Identity, LifecycleCore } from './lifecycle';
import type { ControlCore } from './control';
import type { PersonaPut, RoomPut, RoomTurnEnvelope, RoomTurnMessage, RoomTurnOutcome, Run, StoredObject } from './types';
import { requireThat } from './errors';

/** ARCHITECTURE_V2 A8: bounded, attributed turn-taking in group rooms. The
 * Worker asks exactly one room member at a time for a turn; the member
 * replies with hehebot_send_message or hehebot_pass_turn. Existing SPEC §9.3
 * limits apply: one default responder per owner message, at most 3 bot
 * contributions per owner message (root_cause_id), hop depth 2, fan-out 2.
 *
 * All state lives in room_turn_log (an append-only ledger: one row per
 * scheduled/settled/skipped turn -- never a run_id for SKIPPED), the
 * room_turn_passes marker table (hehebot_pass_turn's dedupe row, sibling of
 * bot_messages), and room_turn_pending (at most one queued continuation per
 * room: an owner message that arrived while the room was busy, or a second
 * fan-out candidate waiting for the first to settle). Never parsed out of
 * context_json in SQL, unlike some older code in this file.
 */
const MAX_HOP = 2;
const MAX_CONTRIBUTIONS = 3;
const MAX_FANOUT = 2;
const DEADLINE_MS = 120000;
const MAX_NEW_MESSAGE_BYTES = 8000;
const MAX_NEW_MESSAGES = 20;
const ACTIVE_ATTEMPT_STATUSES = ['claimed', 'running', 'finishing', 'cancelling'];

export class RoomTurns {
 constructor(private core: ControlCore) {}
 private get store() { return this.core.store; }

 /** True while a scheduled turn for this room has not yet settled. Enforces
  * "one turn at a time per room; other rooms/personas independent" -- this
  * check alone is what makes the scheduler serialize a room. */
 private busy(roomId: string): boolean {
  return this.store.db.all('SELECT id FROM room_turn_log WHERE room_id=? AND outcome IS NULL LIMIT 1', roomId).length > 0;
 }
 private contributions(rootCauseId: string): number {
  return this.store.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM room_turn_log WHERE root_cause_id=? AND outcome='SENT'", rootCauseId)[0].n;
 }
 private peers(room: StoredObject<RoomPut>, exclude: string): { id: string; name: string }[] {
  return room.body.member_ids.filter(id => id !== exclude).map(id => {
   let name = id;
   try { name = this.store.get<PersonaPut>(id, 'persona').body.name; } catch { /* archived/deleted: fall back to id */ }
   return { id, name };
  });
 }
 private newMessages(roomId: string, memberId: string): RoomTurnMessage[] {
  const cursor = this.store.db.all<{ consumed_sequence: number }>(
   'SELECT consumed_sequence FROM consumer_cursors WHERE consumer_id=? AND conversation_id=?', memberId, roomId)[0]?.consumed_sequence ?? 0;
  const rows = this.store.db.all<{ sequence: number; actor_id: string; type: string; payload_json: string }>(
   'SELECT sequence,actor_id,type,payload_json FROM events WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?',
   roomId, cursor, MAX_NEW_MESSAGES);
  const out: RoomTurnMessage[] = [];
  let bytes = 0;
  for (const row of rows) {
   let text = '';
   try { const payload = JSON.parse(row.payload_json) as Record<string, unknown>; text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload); }
   catch { text = ''; }
   const entry: RoomTurnMessage = { sequence: row.sequence, actor_id: row.actor_id, type: row.type, text: text.slice(0, 2000) };
   const size = new TextEncoder().encode(JSON.stringify(entry)).length;
   if (bytes + size > MAX_NEW_MESSAGE_BYTES) break;
   bytes += size; out.push(entry);
  }
  return out;
 }
 private takePending(roomId: string, kind: 'owner' | 'candidate') {
  const row = this.store.db.all<{ member_id: string | null; text: string | null; root_cause_id: string; hop: number }>(
   'SELECT member_id,text,root_cause_id,hop FROM room_turn_pending WHERE room_id=? AND kind=?', roomId, kind)[0];
  if (row) this.store.db.exec('DELETE FROM room_turn_pending WHERE room_id=? AND kind=?', roomId, kind);
  return row;
 }
private logSkipped(roomId: string, memberId: string, rootCauseId: string, hop: number, now: string): void {
  const logId = this.core.options.uuid();
  this.store.db.exec('INSERT INTO room_turn_log(id,room_id,member_id,root_cause_id,hop,run_id,outcome,created_at) VALUES(?,?,?,?,?,NULL,\'SKIPPED\',?)',
   logId, roomId, memberId, rootCauseId, hop, now);
  this.store.event(this.core.options.uuid(), roomId, 'room.turn', memberId, rootCauseId,
   { log_id: logId, member_id: memberId, hop, root_cause_id: rootCauseId, phase: 'settled', outcome: 'SKIPPED' }, now);
 }
 /** Enqueue one scheduled turn's coordinator run for `memberId`. Returns the
  * new run id. The envelope is computed once, here, from durable state the
  * model never supplies. */
 private start(room: StoredObject<RoomPut>, memberId: string, rootCauseId: string, hop: number, commandId: string | null, seedText: string, now: string): string {
  const roomId = room.id;
  const contributionsSoFar = this.contributions(rootCauseId);
  const envelope: RoomTurnEnvelope = {
   room_id: roomId, member_id: memberId, new_messages: this.newMessages(roomId, memberId), peers: this.peers(room, memberId),
   deadline_ms: DEADLINE_MS, is_winding_down: hop >= MAX_HOP || contributionsSoFar + 1 >= MAX_CONTRIBUTIONS,
   root_cause_id: rootCauseId, hop,
  };
  const runId = this.core.enqueue(memberId, seedText, commandId, null, null, roomId, undefined, envelope);
  const logId = this.core.options.uuid();
  this.store.db.exec('INSERT INTO room_turn_log(id,room_id,member_id,root_cause_id,hop,run_id,outcome,created_at) VALUES(?,?,?,?,?,?,NULL,?)',
   logId, roomId, memberId, rootCauseId, hop, runId, now);
  // Portal visibility only (never search-filtered as a bubble, per A7): lets
  // the room thread show "waiting for <bot>" and, once settled, a small muted
  // activity line. Not used by any admission or limit check -- those read
  // room_turn_log directly.
  this.store.event(this.core.options.uuid(), roomId, 'room.turn', memberId, rootCauseId,
   { log_id: logId, member_id: memberId, hop, root_cause_id: rootCauseId, phase: 'started' }, now);
  return runId;
 }
 /** message.send targeting a room (control.ts), gated behind options.roomTurns.
  * Picks the room's configured default responder (else the first member) for
  * hop 0, root_cause_id = the just-committed owner message event id. If the
  * room is already mid-turn, the owner message is not dropped: it is kept as
  * the room's one pending continuation (last-owner-wins, like V4's task-wake
  * batching) and started as a fresh hop-0 chain once the room frees up. */
 scheduleOwnerTurn(roomId: string, commandId: string, ownerEventId: string, text: string): string | null {
  const room = this.store.get<RoomPut>(roomId, 'room');
  const now = this.core.now();
  if (this.busy(roomId)) {
   this.store.db.exec(`INSERT INTO room_turn_pending(room_id,kind,member_id,text,root_cause_id,hop,created_at) VALUES(?,'owner',NULL,?,?,0,?)
    ON CONFLICT(room_id) DO UPDATE SET kind='owner',member_id=NULL,text=excluded.text,root_cause_id=excluded.root_cause_id,hop=0,created_at=excluded.created_at`,
    roomId, text, ownerEventId, now);
   return null;
  }
  return this.start(room, room.body.default_responder_id, ownerEventId, 0, commandId, text, now);
 }
 /** hehebot_pass_turn (runtime RPC 'pass-turn'). Explicit PASS marker, the
  * room-turn sibling of BotMessages.post's message_key row. */
 pass(identity: Identity, input: { run_id: string; attempt: number }, lifecycle: LifecycleCore): { accepted: true } {
  return this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, input.run_id, input.attempt);
   const run = this.store.db.all<Pick<Run, 'current_attempt' | 'status' | 'context_json'>>('SELECT current_attempt,status,context_json FROM runs WHERE id=?', input.run_id)[0];
   requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
   requireThat(run.current_attempt === input.attempt && ACTIVE_ATTEMPT_STATUSES.includes(run.status), 'REVISION_CONFLICT', 'Run is not active.');
   const context = run.context_json !== null ? JSON.parse(run.context_json) as { room_turn?: RoomTurnEnvelope } : {};
   requireThat(!!context.room_turn, 'CAPABILITY_UNAVAILABLE', 'This run is not a scheduled room turn.');
   this.store.db.exec('INSERT OR IGNORE INTO room_turn_passes(run_id,attempt,created_at) VALUES(?,?,?)', input.run_id, input.attempt, this.core.now());
   return { accepted: true };
  });
 }
 /** Called by lifecycle.complete()/interruptRuns() once a room-turn run
  * reaches a genuinely terminal state (not automatically retried). Records
  * the outcome, then decides the next turn per A8: a member mentioned by
  * name/@ in the last sent message, subject to the hop/contribution/fan-out
  * limits, with the room's pending queue taking priority so a fresh owner
  * message is never starved by an in-progress bot-to-bot chain. */
 settle(run: Pick<Run, 'id' | 'persona_id'>, roomTurn: RoomTurnEnvelope, attempt: number, result: { status: string; error_code?: string }): void {
  // No own transaction: every caller (lifecycle.complete()/interruptRuns())
  // already runs inside one, and this must commit atomically with the run's
  // own terminal status write.
  {
   const now = this.core.now();
   const sent = this.store.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM bot_messages WHERE run_id=? AND attempt=?', run.id, attempt)[0].n > 0;
   const passed = this.store.db.all('SELECT 1 FROM room_turn_passes WHERE run_id=? AND attempt=?', run.id, attempt).length > 0;
   let outcome: RoomTurnOutcome;
   if (sent) outcome = 'SENT';
   else if (passed) outcome = 'PASS';
   else if (result.status === 'failed' && result.error_code === 'DEADLINE_EXCEEDED') outcome = 'TIMEOUT';
   else if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'interrupted') outcome = 'ERROR';
   else outcome = 'PASS'; // Completed with nothing sent and no explicit pass: treat as a silent pass, not an error.
   this.store.db.exec('UPDATE room_turn_log SET outcome=? WHERE run_id=?', outcome, run.id);
   const roomId = roomTurn.room_id;
   const logId = this.store.db.all<{ id: string }>('SELECT id FROM room_turn_log WHERE run_id=?', run.id)[0]?.id ?? null;
   this.store.event(this.core.options.uuid(), roomId, 'room.turn', run.persona_id, roomTurn.root_cause_id,
    { log_id: logId, member_id: run.persona_id, hop: roomTurn.hop, root_cause_id: roomTurn.root_cause_id, phase: 'settled', outcome }, now);
   const pendingOwner = this.takePending(roomId, 'owner');
   if (pendingOwner) {
    this.takePending(roomId, 'candidate'); // A fresh owner message supersedes any queued fan-out continuation.
    const room = this.store.get<RoomPut>(roomId, 'room');
    this.start(room, room.body.default_responder_id, pendingOwner.root_cause_id, 0, null, pendingOwner.text ?? '', now);
    return;
   }
   const pendingCandidate = this.takePending(roomId, 'candidate');
   if (pendingCandidate) {
    if (pendingCandidate.hop <= MAX_HOP && this.contributions(pendingCandidate.root_cause_id) < MAX_CONTRIBUTIONS) {
     this.start(this.store.get<RoomPut>(roomId, 'room'), pendingCandidate.member_id!, pendingCandidate.root_cause_id, pendingCandidate.hop, null, '(room turn)', now);
    } else this.logSkipped(roomId, pendingCandidate.member_id!, pendingCandidate.root_cause_id, pendingCandidate.hop, now);
    return;
   }
   if (outcome !== 'SENT') return;
   const lastText = this.store.db.all<{ text: string }>(
    "SELECT json_extract(payload_json,'$.text') AS text FROM events WHERE conversation_id=? AND type='bot.message' AND actor_id=? ORDER BY sequence DESC LIMIT 1",
    roomId, run.persona_id)[0]?.text ?? '';
   const room = this.store.get<RoomPut>(roomId, 'room');
   const names = new Map(room.body.member_ids.map(id => {
    let name = ''; try { name = this.store.get<PersonaPut>(id, 'persona').body.name; } catch { /* archived/deleted: no name match */ }
    return [id, name] as const;
   }));
   const mentioned = mentionedMembers(lastText, room.body.member_ids, run.persona_id, names).slice(0, MAX_FANOUT);
   if (!mentioned.length) return;
   const nextHop = roomTurn.hop + 1, contributionsSoFar = this.contributions(roomTurn.root_cause_id);
   const admitted = nextHop <= MAX_HOP && contributionsSoFar < MAX_CONTRIBUTIONS;
   if (admitted) this.start(room, mentioned[0], roomTurn.root_cause_id, nextHop, null, '(room turn)', now);
   else this.logSkipped(roomId, mentioned[0], roomTurn.root_cause_id, nextHop, now);
   if (mentioned[1]) {
    if (admitted) {
     this.store.db.exec(`INSERT INTO room_turn_pending(room_id,kind,member_id,text,root_cause_id,hop,created_at) VALUES(?,'candidate',?,NULL,?,?,?)
      ON CONFLICT(room_id) DO UPDATE SET kind='candidate',member_id=excluded.member_id,text=NULL,root_cause_id=excluded.root_cause_id,hop=excluded.hop,created_at=excluded.created_at`,
      roomId, mentioned[1], roomTurn.root_cause_id, nextHop, now);
    } else this.logSkipped(roomId, mentioned[1], roomTurn.root_cause_id, nextHop, now);
   }
  }
 }
}
/** Bounded mention detection: an exact-word (case-insensitive) match of a
 * peer's display name, or "@name". Order of first appearance in the text,
 * deduplicated, excluding the sender. This is deliberately simple: it is the
 * only "hand-off" signal A8 defines (name/@ mention), not a separate
 * structured tool argument. */
function mentionedMembers(text: string, memberIds: string[], senderId: string, names: Map<string, string>): string[] {
 if (!text) return [];
 const lower = text.toLowerCase();
 const candidates = memberIds.filter(id => id !== senderId).map(id => {
  const name = (names.get(id) ?? '').toLowerCase();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-z0-9])@?${escaped}([^a-z0-9]|$)`, 'i');
  const match = pattern.exec(lower);
  return match ? { id, index: match.index } : null;
 }).filter((x): x is { id: string; index: number } => x !== null);
 candidates.sort((a, b) => a.index - b.index);
 const seen = new Set<string>(); const out: string[] = [];
 for (const candidate of candidates) { if (seen.has(candidate.id)) continue; seen.add(candidate.id); out.push(candidate.id); }
 return out;
}
