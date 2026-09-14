import { Store } from './store';
import { requireThat } from './errors';
/** Mutual exclusion only. Possessing a lock never grants connector permission. */
export class ResourceLedger {
 constructor(private store:Store,private now:()=>string){}
 acquire(runId:string,attempt:number,resources:string[]):void {
  requireThat(resources.length>0&&resources.length<=8&&new Set(resources).size===resources.length&&resources.every(x=>/^[a-zA-Z0-9:._/-]{1,256}$/.test(x)),'INVALID_INPUT','Invalid resource lock set.',422);
  this.store.db.transaction(()=>{
   const run=this.store.run(runId);requireThat(run.current_attempt===attempt&&['claimed','running','finishing'].includes(run.status),'REVISION_CONFLICT','Resource request is not active.');
   for(const resource of [...resources].sort()){
    const owner=this.store.db.all<{run_id:string;attempt:number}>('SELECT run_id,attempt FROM resource_locks WHERE resource_id=?',resource)[0];
    requireThat(!owner||owner.run_id===runId&&owner.attempt===attempt,'RESOURCE_BUSY','This shared resource is in use.');
    this.store.db.exec('INSERT OR IGNORE INTO resource_locks(resource_id,run_id,attempt,acquired_at) VALUES(?,?,?,?)',resource,runId,attempt,this.now());
   }
  });
 }
 release(runId:string,attempt:number,resources:string[]):void {
  this.store.db.transaction(()=>{
   requireThat(!resources.length||!this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown') LIMIT 1",runId).length,'OUTCOME_UNKNOWN','Reconcile pending effects before releasing shared resources.');
   for(const resource of resources){
    const owner=this.store.db.all<{run_id:string;attempt:number}>('SELECT run_id,attempt FROM resource_locks WHERE resource_id=?',resource)[0];
    requireThat(!owner||owner.run_id===runId&&owner.attempt===attempt,'FORBIDDEN','This task does not own the resource lock.',403);
    this.store.db.exec('DELETE FROM resource_locks WHERE resource_id=? AND run_id=? AND attempt=?',resource,runId,attempt);
   }
  });
 }
}
