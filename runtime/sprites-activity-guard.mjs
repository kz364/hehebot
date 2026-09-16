/** Inject SpritesTasksClient. Supervisor must call ensure before admission and at
 * least every 30 seconds during active work, including silent model/tool work.
 * No timer here: the supervisor owns timer lifetime and native settlement proof. */
export class SpritesActivityGuard {
 constructor({tasks,id,now=Date.now,ttlMs=120000,renewBeforeMs=60000,onUnsafe=()=>{}}){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||ttlMs<30000||ttlMs>3600000||renewBeforeMs<=0||renewBeforeMs>=ttlMs)throw new Error('Invalid activity guard configuration');
  Object.assign(this,{tasks,id,now,ttlMs,renewBeforeMs,onUnsafe});this.receipt=null;this.blocked=false;this.tail=Promise.resolve();
 }
 serialized(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
 ensure(){return this.serialized(async()=>{
  if(this.blocked)throw new Error('Activity guard requires reconciliation');
  try {
   // A suspended process may resume long after its old Task expired. Never
   // silently reclaim ownership. Revalidate the control-plane lease first.
   if(this.receipt&&this.receipt.expiresAt<=this.now())throw new Error('Activity hold expired');
   const priorExpiresAt=this.receipt?.expiresAt;
   if(!this.receipt||this.receipt.expiresAt-this.now()<=this.renewBeforeMs)this.receipt=await this.tasks.hold({id:this.id,expiresAt:this.now()+this.ttlMs});
   // A successful late renewal does not prove uninterrupted custody across the
   // await. Retain any new Task, but require reconciliation before admission.
   if(priorExpiresAt!==undefined&&priorExpiresAt<=this.now())throw new Error('Activity continuity unknown');
   if(this.receipt.name!==this.id||this.receipt.expiresAt<=this.now()+this.renewBeforeMs)throw new Error('Activity hold is not confirmed');
   return {...this.receipt};
  }catch{this.blocked=true;this.onUnsafe();throw new Error('Activity admission blocked; retain existing Task and reconcile');}
 });}
 releaseAfterDrain(proof){return this.serialized(async()=>{
  if(this.blocked||!proof?.controlCommitted||!proof?.nativeSettled||!proof?.checkpointDurable)throw new Error('Drain proof required; activity retained');
  try{await this.tasks.release(this.id);this.receipt=null;}catch{this.blocked=true;this.onUnsafe();throw new Error('Activity release uncertain; reconcile');}
 });}
}
