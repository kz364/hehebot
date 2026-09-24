import type {Store} from './store';
import {nativeDescendantsSettledSql} from './native-tasks';

// A read charge is not an expiring cache. Only settled terminal history may be
// removed; a future retry owns a different attempt and therefore a different key.
// Canonical keys contain a UUID task ID and a variable-width integer attempt.
// Drive the existing metadata key index before exact attempt/run primary-key
// probes, not every terminal run's history. The exact-key check prevents CAST
// aliases (such as :01 or :1junk) from being treated as owned ledger entries.
const eligible=`FROM runtime_metadata m CROSS JOIN attempts a
 ON a.run_id=substr(m.key,13,36) AND a.attempt=CAST(substr(m.key,50) AS INTEGER)
 AND m.key='memory-read:'||a.run_id||':'||a.attempt
 CROSS JOIN runs r ON r.id=a.run_id
 WHERE m.key GLOB 'memory-read:*' AND a.settled_at IS NOT NULL
 AND a.status IN ('completed','failed','cancelled','terminated') AND r.status IN ('completed','failed','cancelled')
 AND NOT EXISTS(SELECT 1 FROM attempts live WHERE live.run_id=r.id AND live.status IN ('claimed','running'))
 AND NOT EXISTS(SELECT 1 FROM retry_queue q WHERE q.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled')
 AND NOT EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown'))
 AND NOT EXISTS(SELECT 1 FROM outbox b WHERE b.run_id=r.id AND b.status!='delivered')
 AND NOT EXISTS(SELECT 1 FROM runtime_metadata q WHERE q.key GLOB 'native-question:*'
  AND json_extract(q.value_json,'$.run_id')=r.id AND COALESCE(json_extract(q.value_json,'$.state'),'unknown') NOT IN ('resolved','closed'))
 AND ${nativeDescendantsSettledSql}`;

export class MemoryReadRetention {
 constructor(private store:Store,private now:()=>string){}
 nextDue():string|null {
  return this.store.db.all<{due:string|null}>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(a.settled_at),'+90 days') AS due ${eligible}`)[0].due;
 }
 prune():number {
  return this.store.db.transaction(()=>{
   const cutoff=new Date(Date.parse(this.now())-90*86400000).toISOString();
   const rows=this.store.db.all<{key:string}>(`SELECT m.key ${eligible} AND a.settled_at<=? ORDER BY a.settled_at,m.key LIMIT 100`,cutoff);
   for(const row of rows)this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?',row.key);
   return rows.length;
  });
 }
}
