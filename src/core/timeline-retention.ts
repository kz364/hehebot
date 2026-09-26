import { createHash } from 'node:crypto';
import type { Store } from './store';
import type { RoomPublish, TimelineEvent } from './types';

// Inputs/results retain 90 days; metadata audit and derived room updates retain 30.
const longLived = "'message.user','room.message','room.action_request','trigger.event','task.followup_queued','run.result','bot.message','notice'";
export const timelineExpirySql = `strftime('%Y-%m-%dT%H:%M:%fZ',created_at,CASE WHEN type IN (${longLived}) THEN '+90 days' ELSE '+30 days' END)`;
export class TimelineRetention {
 constructor(private store: Store, private now: () => string) {}
 nextDue(): string | null {
  return this.store.db.all<{ due: string | null }>(`SELECT MIN(${timelineExpirySql}) AS due FROM events`)[0].due;
 }
 prune(): number {
  return this.store.db.transaction(() => {
   const now = Date.parse(this.now()), cutoff30 = new Date(now - 30 * 86400000).toISOString(), cutoff90 = new Date(now - 90 * 86400000).toISOString();
   const rows = this.store.db.all<Omit<TimelineEvent, 'payload'> & { payload_json: string }>(`SELECT * FROM events WHERE created_at<=? AND (type NOT IN (${longLived}) OR created_at<=?) ORDER BY created_at,sequence LIMIT 100`, cutoff30, cutoff90);
   for (const row of rows) {
    if (['room.message', 'room.context_update', 'room.action_request'].includes(row.type)) {
     const publication = JSON.parse(row.payload_json) as RoomPublish;
     // Preserve exact legacy serialization, not a new canonicalization policy.
     this.store.db.exec('INSERT OR IGNORE INTO room_publications(event_id,room_id,actor_id,cause_id,payload_digest,kind,created_at) VALUES(?,?,?,?,?,?,?)', row.id, row.conversation_id, row.actor_id, row.cause_id, createHash('sha256').update(row.payload_json).digest('hex'), publication.kind, row.created_at);
     if (row.type === 'room.context_update') for (const recipient of publication.recipient_ids) {
      this.store.db.exec('INSERT INTO context_retention(consumer_id,conversation_id,pruned_through) VALUES(?,?,?) ON CONFLICT(consumer_id,conversation_id) DO UPDATE SET pruned_through=MAX(pruned_through,excluded.pruned_through)', recipient, row.conversation_id, row.sequence);
     }
    }
    this.store.db.exec('INSERT INTO event_tombstones(id,sequence,conversation_id,created_at) VALUES(?,?,?,?)', row.id, row.sequence, row.conversation_id, row.created_at);
    this.store.db.exec('DELETE FROM events WHERE id=?', row.id);
   }
   return rows.length;
  });
 }
}
