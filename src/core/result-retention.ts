import type { Store } from './store';

// Only settled terminal work is eligible. Waiting/retry/recovery payloads are not history.
const eligible = `FROM attempts a JOIN runs r ON r.id=a.run_id
 WHERE a.result_json IS NOT NULL AND a.settled_at IS NOT NULL
 AND a.status IN ('completed','failed','cancelled') AND r.status IN ('completed','failed','cancelled')
 AND NOT EXISTS(SELECT 1 FROM retry_queue q WHERE q.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled')
 AND NOT EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown'))
 AND NOT EXISTS(SELECT 1 FROM outbox b WHERE b.run_id=r.id AND b.status!='delivered')`;

export class ResultRetention {
 constructor(private store: Store, private now: () => string) {}
 nextDue(): string | null {
  return this.store.db.all<{ due: string | null }>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(a.settled_at),'+90 days') AS due ${eligible}`)[0].due;
 }
 prune(): number {
  return this.store.db.transaction(() => {
   const cutoff = new Date(Date.parse(this.now()) - 90 * 86400000).toISOString();
   const rows = this.store.db.all<{run_id:string;attempt:number;current_attempt:number}>(`SELECT a.run_id,a.attempt,r.current_attempt ${eligible} AND a.settled_at<=? ORDER BY a.settled_at,a.run_id,a.attempt LIMIT 100`, cutoff);
   for (const row of rows) {
    this.store.db.exec('UPDATE attempts SET result_json=NULL WHERE run_id=? AND attempt=?', row.run_id, row.attempt);
    // The portal copy is replaced on each completion; its age is the latest attempt's
    // settlement, not the outbox creation or delivery-update time.
    if (row.attempt === row.current_attempt) this.store.db.exec("UPDATE outbox SET payload_json='{}' WHERE run_id=? AND destination='portal' AND status='delivered'", row.run_id);
   }
   return rows.length;
  });
 }
}
