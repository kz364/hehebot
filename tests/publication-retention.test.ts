import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { fixture, bot, otherBot } from './helpers';
import type { RoomPublish } from '../src/core/types';

function setup() {
  const f = fixture(), room_id = randomUUID();
  expect(f.accept({ schema_version: 1, type: 'room.put', payload: { id: room_id, expected_revision: 0,
    name: 'Retention fixture', member_ids: [bot, otherBot], default_responder_id: bot } }).status).toBe('applied');
  const payload: RoomPublish = { room_id, kind: 'context_update', recipient_ids: [bot],
    text: 'Publication private canary 43', references: [], cause_id: randomUUID() };
  const publish = (p = payload) => f.accept({ schema_version: 1, type: 'room.publish', payload: p });
  return { ...f, payload, publish };
}

it.each(['context_update', 'message', 'action_request'] as const)('retains %s identity without its timeline payload', kind => {
  const f = setup();
  try {
    const payload = { ...f.payload, kind }, first = f.publish(payload);
    expect(first.status).toBe('applied');
    const runs = f.db.all('SELECT * FROM runs'), cursors = f.db.all('SELECT * FROM consumer_cursors');
    f.db.exec('DELETE FROM events WHERE id=?', first.resource_id!); // Model future timeline pruning, not production cleanup.
    expect(f.publish(payload).resource_id).toBe(first.resource_id);
    expect(f.db.all('SELECT * FROM runs')).toEqual(runs);
    expect(f.db.all('SELECT * FROM consumer_cursors')).toEqual(cursors);
    expect(JSON.stringify(f.db.all('SELECT * FROM room_publications'))).not.toContain(payload.text);
    expect(f.publish({ ...payload, text: 'Distinct publication 71' }).resource_id).not.toBe(first.resource_id);
  } finally { f.close(); }
});

it('counts each causal contribution once across retained identities and legacy events, even after timeline loss', () => {
  const f = setup();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = f.publish({ ...f.payload, kind: 'action_request', text: `Contribution ${i}` });
      expect(result.status).toBe('applied'); ids.push(result.resource_id!);
    }
    // One pre-migration event, one ledger-only publication, and one represented in both.
    f.db.exec('DELETE FROM room_publications WHERE event_id=?', ids[0]);
    f.db.exec('DELETE FROM events WHERE id=?', ids[1]);
    expect(f.publish({ ...f.payload, kind: 'action_request', text: 'Contribution 0' }).resource_id).toBe(ids[0]);
    expect(f.publish({ ...f.payload, kind: 'action_request', text: 'Fourth forbidden contribution' })).toMatchObject({ status: 'rejected', error: { code: 'DEADLINE_EXCEEDED' } });
    expect(f.db.all('SELECT * FROM runs')).toHaveLength(3);
    expect(f.db.all('SELECT * FROM room_publications')).toHaveLength(2);
    expect(f.publish({ ...f.payload, kind: 'action_request', cause_id: randomUUID(), text: 'Independent cause' }).status).toBe('applied');
  } finally { f.close(); }
});
