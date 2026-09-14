import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { fixture, bot, otherBot } from './helpers';
import { TimelineRetention } from '../src/core/timeline-retention';

it('prunes mixed-age interior holes and all rows without regressing the cursor or losing provenance', () => {
  const f = fixture(), retention = new TimelineRetention(f.store, () => f.core.now());
  try {
    const source = randomUUID();
    f.store.event(source, bot, 'message.user', 'owner', null, { text: 'Private source 43' }, f.core.now());
    const audit = f.store.event(randomUUID(), null, 'memory.updated', 'owner', null, { id: '19' }, f.core.now());
    const last = f.store.event(randomUUID(), bot, 'run.result', 'runtime', null, { text: 'Result 71' }, f.core.now());
    expect(retention.nextDue()).toBe('2026-10-10T00:00:00.000Z');
    f.setNow('2026-10-09T23:59:59.999Z'); expect(retention.prune()).toBe(0);
    f.setNow('2026-10-10T00:00:00.000Z'); expect(retention.prune()).toBe(1);
    expect(() => f.core.state(audit - 1)).toThrowError(expect.objectContaining({ code: 'HISTORY_GAP' }));
    expect(f.core.state(audit).events.map(e => e.sequence)).toEqual([last]);
    expect(f.core.state().timeline!.map(e => e.sequence)).toEqual([1, last]);
    f.setNow('2026-12-09T00:00:00.000Z'); expect(retention.prune()).toBe(2);
    expect(f.core.state().next_cursor).toBe(String(last)); expect(f.core.state().timeline).toEqual([]);
    expect(() => f.core.state(last - 1)).toThrowError(expect.objectContaining({ code: 'HISTORY_GAP' }));
    expect(retention.nextDue()).toBeNull();
    expect(JSON.stringify(f.db.all('SELECT * FROM event_tombstones'))).not.toContain('Private source');
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: { id: randomUUID(), expected_revision: 0,
      scope: { kind: 'persona', id: bot }, text: 'Explicit new memory', source_event_id: source,
      expires_at: null, sensitivity: 'ordinary' } }).status).toBe('applied');
    expect(f.store.sequence()).toBeGreaterThan(last);
  } finally { f.close(); }
});

it('backfills legacy room identity before pruning and reports a recipient-scoped context gap without consumption', () => {
  const f = fixture(), retention = new TimelineRetention(f.store, () => f.core.now());
  try {
    const room = randomUUID();
    f.accept({ schema_version: 1, type: 'room.put', payload: { id: room, expected_revision: 0,
      name: 'Context room', member_ids: [bot, otherBot], default_responder_id: bot } });
    const payload = { room_id: room, kind: 'context_update' as const, recipient_ids: [bot], text: 'Expired update 43', references: [], cause_id: randomUUID() };
    const publish = () => f.accept({ schema_version: 1, type: 'room.publish', payload });
    const original = publish();
    const sequence = f.store.sequence();
    f.db.exec('DELETE FROM room_publications'); // Legacy timeline-only representation.
    f.setNow('2026-10-09T00:00:00.000Z');
    f.accept({ schema_version: 1, type: 'room.publish', payload: { ...payload, text: 'Retained update 71', cause_id: randomUUID() } });
    const cursors = f.db.all('SELECT * FROM consumer_cursors');
    f.setNow('2026-10-10T00:00:00.000Z'); retention.prune();
    const context = f.core.context(bot, 'Read', null, room);
    expect(context.context_history_gap).toEqual({ requested_after: 0, expired_through: sequence });
    expect(context.context_events.map(e => e.payload.text)).toEqual(['Retained update 71']);
    expect(f.core.context(otherBot, 'Read', null, room).context_history_gap).toBeUndefined();
    expect(f.db.all('SELECT * FROM consumer_cursors')).toEqual(cursors);
    expect(publish().resource_id).toBe(original.resource_id);
    expect(f.db.all('SELECT * FROM runs')).toEqual([]);
    expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')).toEqual([{ desired_state: 'STOP', queue_sequence: 0 }]);
  } finally { f.close(); }
});

it('bounds pruning and fills a recent snapshot from surviving rows rather than a sequence window', () => {
  const f = fixture(), retention = new TimelineRetention(f.store, () => f.core.now());
  try {
    for (let i = 0; i < 105; i++) {
      f.store.event(randomUUID(), bot, 'message.user', 'owner', null, { i }, f.core.now());
      f.store.event(randomUUID(), null, 'memory.updated', 'owner', null, { i }, f.core.now());
    }
    f.setNow('2026-10-10T00:00:00.000Z');
    expect(retention.prune()).toBe(100); expect(retention.nextDue()).toBe(f.core.now());
    expect(retention.prune()).toBe(5); expect(retention.prune()).toBe(0);
    expect(f.core.state().timeline!.map(e => e.payload.i)).toEqual(Array.from({ length: 100 }, (_, i) => i + 5));
  } finally { f.close(); }
});

it('preserves legacy spent budgets, original receipts, and unresolved work/locks/effects through real pruning', () => {
  const f = fixture(), retention = new TimelineRetention(f.store, () => f.core.now());
  try {
    const room = randomUUID(), cause = randomUUID();
    f.accept({ schema_version: 1, type: 'room.put', payload: { id: room, expected_revision: 0,
      name: 'Legacy actions', member_ids: [bot], default_responder_id: bot } });
    const publish = (text: string) => f.accept({ schema_version: 1, type: 'room.publish', payload: {
      room_id: room, kind: 'action_request', recipient_ids: [bot], text, references: [], cause_id: cause,
    } });
    const receipts = [publish('Action 19'), publish('Action 43'), publish('Action 71')];
    expect(receipts.every(r => r.status === 'applied')).toBe(true);
    f.db.exec('DELETE FROM room_publications');
    const run = f.db.all<{id:string}>('SELECT id FROM runs ORDER BY id LIMIT 1')[0].id;
    f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", run);
    f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)', 'calendar-43', run, f.core.now());
    f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','outcome_unknown','policy','digest',?)", randomUUID(), run, 'effect-71', f.core.now());
    const tables = ['commands', 'runs', 'resource_locks', 'effects'];
    const before = tables.map(table => f.db.all(`SELECT * FROM ${table}`));
    f.setNow('2026-12-09T00:00:00.000Z'); retention.prune();
    expect(tables.map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
    expect(receipts.map(r => f.core.receipt(r.id))).toEqual(receipts);
    expect(publish('Action 19').resource_id).toBe(receipts[0].resource_id);
    expect(publish('Fourth forbidden action')).toMatchObject({ status: 'rejected', error: { code: 'DEADLINE_EXCEEDED' } });
  } finally { f.close(); }
});

it('excludes overdue backlog from snapshots and recipient input before physical pruning finishes', () => {
  const f = fixture(), retention = new TimelineRetention(f.store, () => f.core.now());
  try {
    const room = randomUUID();
    f.accept({ schema_version: 1, type: 'room.put', payload: { id: room, expected_revision: 0,
      name: 'Backlog room', member_ids: [bot, otherBot], default_responder_id: bot } });
    f.store.event(randomUUID(), room, 'message.user', 'owner', null, { text: 'Retained message 19' }, f.core.now());
    const publish = (text: string) => f.accept({ schema_version: 1, type: 'room.publish', payload: {
      room_id: room, kind: 'context_update', recipient_ids: [bot], text, references: [], cause_id: randomUUID(),
    } });
    for (let i = 0; i < 101; i++) expect(publish(`Expired update ${i}`).status).toBe('applied');
    const expiredThrough = f.store.sequence();
    f.setNow('2026-10-10T00:00:00.000Z'); publish('Current update 71');
    expect(retention.prune()).toBe(100);
    expect(f.db.all("SELECT id FROM events WHERE type='room.context_update'")).toHaveLength(3); // Two overdue rows still physically present.
    const context = f.core.context(bot, 'Read', null, room);
    expect(context.context_events.map(e => e.payload.text)).toEqual(['Current update 71']);
    expect(context.context_history_gap).toEqual({ requested_after: 0, expired_through: expiredThrough });
    expect(f.core.context(otherBot, 'Read', null, room).context_history_gap).toBeUndefined();
    expect(() => f.core.state(expiredThrough - 1)).toThrowError(expect.objectContaining({ code: 'HISTORY_GAP' }));
    expect(f.core.state().timeline!.map(e => e.payload.text)).toEqual(['Retained message 19', 'Current update 71']);
    expect(f.core.state(expiredThrough).events.map(e => e.payload.text)).toEqual(['Current update 71']);
  } finally { f.close(); }
});
