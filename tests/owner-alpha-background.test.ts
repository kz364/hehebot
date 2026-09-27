import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TestDatabase,bot,otherBot} from './helpers';
import {PersonalControl} from '../src/worker/control-object';
import {OwnerAlpha,parseOwnerAlpha,type OwnerAlphaPolicy} from '../src/core/owner-alpha';
import {Store} from '../src/core/store';
import {ROUTINE_MANAGE_POLICY} from '../src/core/agent-commands';
import {runFalsyRoomCases} from './run-room-cases';

vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../DB/schema.sql',()=>({default:''}));
const base={AUTH_MODE:'local',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}'};
let db:TestDatabase,control:PersonalControl,policy:OwnerAlphaPolicy;
async function initialize(config=policy){
 let ready:Promise<unknown>=Promise.resolve();
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>db.transaction(fn),getAlarm: async () => null,setAlarm:async()=>{},deleteAlarm:async()=>{}},blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{ready=fn();}};
 control=new PersonalControl(ctx as unknown as DurableObjectState,{...base,HEHEBOT_OWNER_ALPHA:JSON.stringify(config),ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}'} as Env);await ready;
}
beforeEach(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));db=new TestDatabase();
 policy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:2,max_task_seconds:45,background_first_root:true};await initialize();
 const store=new Store(db),persona=store.get(bot,'persona');
 store.put(bot,'persona',{...persona.body,tool_policy_ids:[ROUTINE_MANAGE_POLICY]},persona.revision,'operator',new Date().toISOString());
});
afterEach(()=>{db.close();vi.useRealTimers();});
async function runtime(type:string,payload:unknown):Promise<any>{const result=await control.runtime({type,payload});expect(result).toMatchObject({ok:true});return (result as any).value;}
async function denied(type:string,payload:unknown,code:string){expect(await control.runtime({type,payload})).toMatchObject({ok:false,error:{code}});}
async function message(){
 expect(await control.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic bounded task'}})).toMatchObject({ok:true,value:{status:'applied'}});
}
async function boot(){const identity=await runtime('boot',{boot_id:randomUUID()});await runtime('ready',{identity});return identity;}
const custody=()=>JSON.parse(db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha'")[0].value_json);
const receipt=(parent:string)=>({parent_run_id:parent,parent_attempt:1,persona_id:bot,native_run_ref:randomUUID(),native_session_key:randomUUID(),title:'Observed child'});
async function first(){const identity=await boot();await message();const claim=await runtime('claim',{identity});await runtime('submitted',{identity,run_id:claim.run.id,attempt:1,native_ref:'root'});return {identity,claim};}

it('retains overflow child custody without inherited alpha skill or routine authority',async()=>{
 const {identity,claim}=await first(),input=receipt(claim.run.id);
 db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?) WHERE id=?",'界'.repeat(400000),claim.run.id);
 const source=db.all('SELECT context_json FROM runs WHERE id=?',claim.run.id);
 const child=await runtime('native-child',{identity,child:input,started:true});
 expect(child).toMatchObject({status:'cancelling',error_code:'CONTEXT_PREPARATION_LIMIT',parent_run_id:claim.run.id,persona_id:bot});
 const scope={identity,run_id:child.id,attempt:1};
 await denied('agent-routines',scope,'FORBIDDEN');
 await denied('agent-skill',{...scope,skill_id:randomUUID()},'FORBIDDEN');
 expect((await runtime('heartbeat',{identity,operations:[]})).cancellations).toContain(child.id);
 expect(await runtime('native-child',{identity,child:input,started:true})).toEqual(child);
 expect(db.all('SELECT context_json FROM runs WHERE id=?',claim.run.id)).toEqual(source);
 expect(db.all('SELECT status,settled_at FROM attempts WHERE run_id=?',child.id)).toEqual([{status:'claimed',settled_at:null}]);
});

it('validates native child custody without hydrating child or root snapshots',async()=>{
 const {identity,claim}=await first(),child=await runtime('native-child',{identity,child:receipt(claim.run.id),started:true});
 db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?),checkpoint_json=?",
  '界'.repeat(400000),JSON.stringify({padding:'x'.repeat(1100000)}));
 const snapshots=db.all('SELECT id,context_json,checkpoint_json FROM runs ORDER BY id');
 const alpha=new OwnerAlpha(new Store(db),policy,()=>new Date().toISOString()),read=vi.spyOn(db,'all');
 try{
  expect(()=>alpha.authorize(child.id,1)).not.toThrow();
  const selections=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')?[{id,rows:read.mock.results[i].value}]:[]);
  expect(selections.some(s=>s.id===child.id)).toBe(true);
  expect(selections.some(s=>s.id===claim.run.id)).toBe(true);
  for(const selection of selections)for(const row of selection.rows){
   expect(row).not.toHaveProperty('checkpoint_json');
   expect(row).not.toHaveProperty('context_json');
  }
 }finally{read.mockRestore();}
 expect(db.all('SELECT id,context_json,checkpoint_json FROM runs ORDER BY id')).toEqual(snapshots);
});

it.each(runFalsyRoomCases.map((value,index)=>({...value,index})))('preserves root room authority for native custody: $index',async({context,allowed,error})=>{
 const {identity,claim}=await first(),child=await runtime('native-child',{identity,child:receipt(claim.run.id),started:true});
 db.exec('UPDATE runs SET context_json=? WHERE id=?',context,claim.run.id);
 // A child's inherited room is not an additional authority source.
 db.exec("UPDATE runs SET context_json='null' WHERE id=?",child.id);
 const alpha=new OwnerAlpha(new Store(db),policy,()=>new Date().toISOString());
 if(error)expect(()=>alpha.authorize(child.id,1)).toThrowError(expect.objectContaining({name:error}));
 else if(allowed)expect(()=>alpha.authorize(child.id,1)).not.toThrow();
 else expect(()=>alpha.authorize(child.id,1)).toThrow('Attempt is not owned');
});

it('propagates root cancellation with metadata-only child selection',async()=>{
 const {identity,claim}=await first(),child=await runtime('native-child',{identity,child:receipt(claim.run.id),started:true});
 db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?),checkpoint_json=?",
  '界'.repeat(400000),JSON.stringify({padding:'x'.repeat(1100000)}));
 const snapshots=db.all('SELECT id,context_json,checkpoint_json FROM runs ORDER BY id');
 db.exec("UPDATE runs SET status='cancelling',error_code='OWNER_CANCELLED' WHERE id=?",claim.run.id);
 const read=vi.spyOn(db,'all');
 try{
  expect(await runtime('heartbeat',{identity,operations:[]})).toMatchObject({cancellations:expect.arrayContaining([claim.run.id,child.id])});
  const selections=read.mock.calls.flatMap(([sql],i)=>sql.includes('FROM runs WHERE parent_run_id=?')?[read.mock.results[i].value]:[]);
  expect(selections.length).toBeGreaterThan(0);
  for(const rows of selections)for(const row of rows){
   expect(Object.keys(row).sort()).toEqual(['error_code','id','status','updated_at']);
   expect(row.id).toBe(child.id);
  }
 }finally{read.mockRestore();}
 const cancelled=db.all('SELECT status,error_code,updated_at FROM runs WHERE id=?',child.id);
 expect(cancelled).toEqual([{status:'cancelling',error_code:'OWNER_CANCELLED',updated_at:new Date().toISOString()}]);
 vi.setSystemTime(new Date('2026-09-10T00:00:10.000Z'));await runtime('heartbeat',{identity,operations:[]});
 expect(db.all('SELECT status,error_code,updated_at FROM runs WHERE id=?',child.id)).toEqual(cancelled);
 expect(db.all('SELECT id,context_json,checkpoint_json FROM runs ORDER BY id')).toEqual(snapshots);
});

it('accepts only literal true and preserves absent serialization and immutable policy',async()=>{
 const {background_first_root:_,...old}=policy;
 expect(JSON.stringify(parseOwnerAlpha(JSON.stringify(old),base))).toBe(JSON.stringify(old));
 expect(parseOwnerAlpha(JSON.stringify(policy),base)).toEqual(policy);
 for(const value of [false,null,0,1,'true'])expect(()=>parseOwnerAlpha(JSON.stringify({...old,background_first_root:value}),base)).toThrow();
 await expect(initialize(old)).rejects.toThrow();await initialize();
 expect(await runtime('status',{})).toMatchObject({owner_alpha:policy,execution_enabled:false});
});

it('keeps default claims and status unchanged and refuses an in-place opt-in',async()=>{
 db.close();db=new TestDatabase();const {background_first_root:_,...old}=policy;await initialize(old);
 expect(await runtime('status',{})).toEqual({phase:'STOPPED',epoch:0,execution_enabled:false,owner_alpha:old});
 const {identity,claim}=await first();expect(claim).not.toHaveProperty('owner_alpha_background');
 await denied('native-child',{identity,child:receipt(claim.run.id)},'CAPABILITY_UNAVAILABLE');
 await expect(initialize()).rejects.toThrow();
});

it('selects the first durable root atomically, restores it, and excludes observed children from quota',async()=>{
 const identity=await boot();await message();await message();await message();
 db.sqlite.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 expect(await control.runtime({type:'claim',payload:{identity}})).toMatchObject({ok:false});expect(custody().admitted_run_ids).toEqual([]);
 db.sqlite.exec('DROP TRIGGER fail_claim');
 const first=await runtime('claim',{identity});expect(first.owner_alpha_background).toBe(true);
 const child=receipt(first.run.id);await runtime('native-child',{identity,child,started:true});
 // Observations are custody, not a dispatch gate or a one-child-ever counter.
 await runtime('native-child',{identity,child:receipt(first.run.id)});
 await runtime('submitted',{identity,run_id:first.run.id,attempt:1,native_ref:'root'});
 await runtime('coordinator-release',{identity,run_id:first.run.id,attempt:1,native_ref:'root',outcome:'completed'});
 await initialize();const second=await runtime('claim',{identity});expect(second).not.toHaveProperty('owner_alpha_background');
 expect(custody().admitted_run_ids).toEqual([first.run.id,second.run.id]);
 await denied('native-child',{identity,child:receipt(second.run.id)},'FORBIDDEN');
 await runtime('submitted',{identity,run_id:second.run.id,attempt:1,native_ref:'root2'});
 await runtime('coordinator-release',{identity,run_id:second.run.id,attempt:1,native_ref:'root2',outcome:'completed'});
 await initialize();expect(await runtime('claim',{identity})).toBeNull();expect(db.all('SELECT * FROM attempts')).toHaveLength(4);
});

it('keeps exact child identity, inherited deadline, replay and root-only fences',async()=>{
 const {identity,claim}=await first(),child=receipt(claim.run.id),run=await runtime('native-child',{identity,child,started:true});
 expect(run).toMatchObject({role:'background',status:'running',parent_run_id:claim.run.id,persona_id:bot});
 expect(db.all('SELECT deadline_at FROM attempts WHERE run_id=?',run.id)).toEqual([{deadline_at:claim.deadline_at}]);
 expect(await runtime('native-child',{identity,child,started:true})).toEqual(run);await initialize();
 await denied('native-child',{identity,child:receipt(run.id)},'FORBIDDEN');
 await denied('native-child',{identity,child:{...receipt(claim.run.id),persona_id:otherBot}},'FORBIDDEN');
 await denied('native-child',{identity,child:{...child,native_session_key:'wrong'}},'IDEMPOTENCY_CONFLICT');
 await denied('coordinator-release',{identity,run_id:run.id,attempt:1,native_ref:child.native_run_ref,outcome:'completed'},'FORBIDDEN');
 const scope={identity,run_id:run.id,attempt:1};
 for(const [type,payload] of [['complete',{...scope,result:{status:'completed',text:'no'}}],['prepare-sleep',{identity}],['resource-acquire',{...scope,resources:['x']}],['effect-result',{...scope,effect_id:randomUUID(),status:'confirmed',receipt:{}}]] as const)await denied(type,payload,'CAPABILITY_UNAVAILABLE');
 await denied('submitted',{...scope,attempt:2,native_ref:child.native_run_ref},'STALE_EPOCH');
 await denied('submitted',{...scope,identity:{...identity,boot_id:randomUUID()},native_ref:child.native_run_ref},'STALE_EPOCH');
});

it.each(['DEADLINE_EXCEEDED','OWNER_CANCELLED','CONTEXT_INVALIDATED'])('retains late observations and cancellation read fences for %s',async(reason)=>{
 const {identity,claim}=await first();
 const early=await runtime('native-child',{identity,child:receipt(claim.run.id),started:true});
 if(reason==='OWNER_CANCELLED'){
  expect(await control.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'run.cancel',payload:{run_id:claim.run.id,reason:'stop'}})).toMatchObject({ok:true,value:{status:'applied'}});
  await denied('agent-routines',{identity,run_id:early.id,attempt:1},'REVISION_CONFLICT');
 }
 if(reason==='CONTEXT_INVALIDATED')db.exec("UPDATE runs SET status='cancelling',error_code='CONTEXT_INVALIDATED' WHERE id=? OR parent_run_id=?",claim.run.id,claim.run.id);
 vi.setSystemTime(new Date(claim.deadline_at));await control.alarm();
 const child=receipt(claim.run.id),late=await runtime('native-child',{identity,child,started:true});
 expect(late).toMatchObject({status:'cancelling',error_code:reason});
 const changes=db.all<{n:number}>('SELECT total_changes() AS n')[0].n;
 expect(await runtime('native-child',{identity,child,started:true})).toEqual(late);
 expect(db.all<{n:number}>('SELECT total_changes() AS n')[0].n).toBe(changes);
 for(const run of [early,late]){
  const scope={identity,run_id:run.id,attempt:1};
  if(reason==='DEADLINE_EXCEEDED')expect(await runtime('agent-routines',scope)).toMatchObject({routines:[]});
  else await denied('agent-routines',scope,'REVISION_CONFLICT');
 }
 const operation={id:randomUUID(),run_id:early.id,attempt:1,kind:'inference',status:'unknown',started_at:'2026-09-10T00:00:00.000Z',deadline_at:claim.deadline_at,last_progress_at:'2026-09-10T00:00:00.000Z'};
 expect(await runtime('heartbeat',{identity,operations:[operation]})).toMatchObject({cancellations:expect.arrayContaining([early.id,late.id])});
 await initialize();expect(db.all('SELECT status FROM operations')).toEqual([{status:'unknown'}]);
 await denied('prepare-sleep',{identity},'CAPABILITY_UNAVAILABLE');expect(db.all('SELECT * FROM retry_queue')).toEqual([]);
});

it.each([
 "UPDATE attempts SET epoch=2 WHERE run_id=?",
 "UPDATE attempts SET boot_id='wrong' WHERE run_id=?",
 "UPDATE attempts SET deadline_at='2026-09-10T00:00:44.000Z' WHERE run_id=?",
 "UPDATE attempts SET native_run_ref='wrong' WHERE run_id=?",
 "UPDATE runs SET current_attempt=2 WHERE id=?",
 "UPDATE runs SET parent_run_id=NULL WHERE id=?",
 `UPDATE runs SET persona_id='${otherBot}' WHERE id=?`,
 "UPDATE native_task_links SET parent_attempt=2 WHERE run_id=?",
 "DELETE FROM native_task_links WHERE run_id=?",
])('fails closed on durable child corruption: %s',async sql=>{
 const {identity,claim}=await first(),child=receipt(claim.run.id),run=await runtime('native-child',{identity,child});db.exec(sql,run.id);
 await denied('submitted',{identity,run_id:run.id,attempt:1,native_ref:child.native_run_ref},'STALE_EPOCH');
 await expect(initialize()).rejects.toThrow();
});
