import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TestDatabase,bot,otherBot,fixture} from './helpers';
import {PersonalControl} from '../src/worker/control-object';
import {Store} from '../src/core/store';
import {ROUTINE_MANAGE_POLICY} from '../src/core/agent-commands';
import {LifecycleCore} from '../src/core/lifecycle';
import {NativeTaskLedger} from '../src/core/native-tasks';

vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../DB/schema.sql',()=>({default:''}));

const base={AUTH_MODE:'local',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}'};
let db:TestDatabase,control:PersonalControl;
const policy={session_id:'21000000-0000-4000-8000-000000000091',persona_id:bot,expires_at:'2026-09-10T00:02:00.000Z',max_runs:2,max_task_seconds:91,background_first_root:true as const};

async function initialize(){
 let ready:Promise<unknown>=Promise.resolve();
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>db.transaction(fn),setAlarm:async()=>{},deleteAlarm:async()=>{}},blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{ready=fn();}};
 control=new PersonalControl(ctx as unknown as DurableObjectState,{...base,HEHEBOT_OWNER_ALPHA:JSON.stringify(policy),ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}'} as Env);await ready;
}
async function runtime(type:string,payload:unknown):Promise<any>{const result=await control.runtime({type,payload});expect(result).toMatchObject({ok:true});return (result as any).value;}
async function message(text:string){expect(await control.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}})).toMatchObject({ok:true,value:{status:'applied'}});}
async function boot(){const identity=await runtime('boot',{boot_id:'31000000-0000-4000-8000-000000000073'});await runtime('ready',{identity});return identity;}
const child=(root:string,thread:string,turn:string,title:string)=>({parent_run_id:root,parent_attempt:1,persona_id:bot,native_run_ref:turn,native_session_key:thread,title});
const custody=()=>JSON.parse(db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha'")[0].value_json);

beforeEach(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));db=new TestDatabase();await initialize();
 const store=new Store(db),persona=store.get(bot,'persona');
 store.put(bot,'persona',{...persona.body,tool_policy_ids:[ROUTINE_MANAGE_POLICY]},persona.revision,'operator',new Date().toISOString());
});
afterEach(()=>{db.close();vi.useRealTimers();});

it('retains sequential V2 thread-turn receipts, including a later turn on an evicted child thread, without spending root quota',async()=>{
 const identity=await boot();await message('Root R coordinates sequential work');
 const claim=await runtime('claim',{identity});
 await runtime('submitted',{identity,run_id:claim.run.id,attempt:1,native_ref:'root-turn-r-401'});
 const a1Receipt=child(claim.run.id,'thread-a-17','turn-a-101','A first resident turn');
 const a1=await runtime('native-child',{identity,child:a1Receipt,started:true});
 // Native completion/eviction is deliberately not represented as Worker settlement.
 const bReceipt=child(claim.run.id,'thread-b-83','turn-b-509','B after A eviction');
 const b=await runtime('native-child',{identity,child:bReceipt,started:true});
 const a2Receipt=child(claim.run.id,'thread-a-17','turn-a-907','A follow-up after B');
 const a2=await runtime('native-child',{identity,child:a2Receipt,started:true});

 expect(new Set([a1.id,b.id,a2.id]).size).toBe(3);
 expect(custody().admitted_run_ids).toEqual([claim.run.id]);
 const rootAttempt=db.all<any>('SELECT * FROM attempts WHERE run_id=? AND attempt=1',claim.run.id)[0];
 const rows=db.all<any>(`SELECT r.id,r.parent_run_id,r.command_id,r.persona_id,r.role,r.context_json,
  a.attempt,a.submission_key,a.native_run_ref,a.epoch,a.boot_id,a.deadline_at,
  l.parent_attempt,l.native_session_key
  FROM runs r JOIN attempts a ON a.run_id=r.id JOIN native_task_links l ON l.run_id=r.id
  WHERE r.id IN (?,?,?) ORDER BY a.native_run_ref`,a1.id,b.id,a2.id);
 expect(rows.map(({context_json,...row}:any)=>row)).toEqual([
  {id:a1.id,parent_run_id:claim.run.id,command_id:claim.run.command_id,persona_id:bot,role:'background',attempt:1,submission_key:'native:turn-a-101',native_run_ref:'turn-a-101',epoch:1,boot_id:identity.boot_id,deadline_at:claim.deadline_at,parent_attempt:1,native_session_key:'thread-a-17'},
  {id:a2.id,parent_run_id:claim.run.id,command_id:claim.run.command_id,persona_id:bot,role:'background',attempt:1,submission_key:'native:turn-a-907',native_run_ref:'turn-a-907',epoch:1,boot_id:identity.boot_id,deadline_at:claim.deadline_at,parent_attempt:1,native_session_key:'thread-a-17'},
  {id:b.id,parent_run_id:claim.run.id,command_id:claim.run.command_id,persona_id:bot,role:'background',attempt:1,submission_key:'native:turn-b-509',native_run_ref:'turn-b-509',epoch:1,boot_id:identity.boot_id,deadline_at:claim.deadline_at,parent_attempt:1,native_session_key:'thread-b-83'},
 ]);
 for(const row of rows){
  const context=JSON.parse(row.context_json),root=JSON.parse(claim.run.context_json);
  expect({...context,instruction:root.instruction}).toEqual(root);
 }
 expect(rootAttempt).toMatchObject({epoch:1,boot_id:identity.boot_id,deadline_at:claim.deadline_at,native_run_ref:'root-turn-r-401'});
 const changes=db.all<{n:number}>('SELECT total_changes() AS n')[0].n;
 expect(await runtime('native-child',{identity,child:a2Receipt,started:true})).toEqual(a2);
 expect(db.all<{n:number}>('SELECT total_changes() AS n')[0].n).toBe(changes);
 expect(db.all('SELECT run_id,parent_run_id,parent_attempt,native_run_ref,native_session_key FROM native_task_links ORDER BY native_run_ref')).toHaveLength(3);
});

it.each(['parent','attempt','persona'])('atomically denies changing retained thread %s custody outside alpha policy',mode=>{
 const f=fixture(true);
 try{
  f.core.options.delegations={[bot]:[otherBot]};
  const life=new LifecycleCore(f.store,f.core),ledger=new NativeTaskLedger(f.store,f.core,life);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity=life.registerBoot(randomUUID());life.ready(identity);
  const root=f.core.enqueue(bot,'Original root',null,null,null);life.claim(identity);
  const receipt=child(root,'thread-19','turn-431','First turn');
  const first=ledger.register(identity,receipt,true);
  ledger.register(identity,{...receipt,native_run_ref:'turn-877'},true);
  const next={...receipt,native_run_ref:'turn-991'};
  if(mode==='parent'){
   life.complete(identity,root,1,{status:'completed',text:'Released'});
   next.parent_run_id=f.core.enqueue(bot,'Independent root',null,null,null);life.claim(identity);
  }else if(mode==='attempt'){
   // A later same-lease attempt is otherwise authorized, but cannot inherit this thread.
   f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,2,?,1,?,'running','2026-09-10T00:01:31.000Z')",root,`${root}:2`,identity.boot_id);
   f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?',root);next.parent_attempt=2;
  }else next.persona_id=otherBot;
  const before=['runs','attempts','native_task_links','events'].map(table=>f.db.all(`SELECT * FROM ${table}`));
  expect(()=>ledger.register(identity,next,true)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  expect(['runs','attempts','native_task_links','events'].map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
  expect(f.store.run(first.id).parent_run_id).toBe(root);
 }finally{f.close();}
});

it('retains cancellation and old receipts on replay and a late follow-up after restart',async()=>{
 const identity=await boot();await message('Root with repeated follow-ups');
 const root=await runtime('claim',{identity});await runtime('submitted',{identity,run_id:root.run.id,attempt:1,native_ref:'root-turn-173'});
 const receipt=child(root.run.id,'thread-37','turn-251','First child');
 const first=await runtime('native-child',{identity,child:receipt,started:true});
 const second=await runtime('native-child',{identity,child:{...receipt,native_run_ref:'turn-683'},started:true});
 await control.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'run.cancel',payload:{run_id:root.run.id,reason:'Stop original custody'}});
 const heartbeat=await runtime('heartbeat',{identity,operations:[]});
 expect(heartbeat.cancellations).toEqual(expect.arrayContaining([root.run.id,first.id,second.id]));
 const before=db.all('SELECT * FROM runs WHERE id IN (?,?) ORDER BY id',first.id,second.id);
 const attempts=db.all('SELECT * FROM attempts WHERE run_id IN (?,?) ORDER BY run_id',first.id,second.id);
 await initialize();
 await runtime('native-child',{identity,child:{...receipt,title:'Replay must not replace title'},started:true});
 const late=await runtime('native-child',{identity,child:{...receipt,native_run_ref:'turn-947'},started:true});
 expect(late).toMatchObject({status:'cancelling',error_code:'OWNER_CANCELLED',parent_run_id:root.run.id});
 expect(db.all('SELECT * FROM runs WHERE id IN (?,?) ORDER BY id',first.id,second.id)).toEqual(before);
 expect(db.all('SELECT * FROM attempts WHERE run_id IN (?,?) ORDER BY run_id',first.id,second.id)).toEqual(attempts);
 expect(db.all('SELECT deadline_at,status FROM attempts WHERE run_id=?',late.id)).toEqual([{deadline_at:root.deadline_at,status:'claimed'}]);
 expect(custody().admitted_run_ids).toEqual([root.run.id]);
});

it('does not reparent retained sequential children after coordinator release and cancels them when loaded inventory omits them',async()=>{
 const identity=await boot();await message('Root R with retained children');await message('Independent root S');
 const r=await runtime('claim',{identity});await runtime('submitted',{identity,run_id:r.run.id,attempt:1,native_ref:'root-turn-r-613'});
 const a=await runtime('native-child',{identity,child:child(r.run.id,'thread-a-29','turn-a-211','A retained'),started:true});
 const b=await runtime('native-child',{identity,child:child(r.run.id,'thread-b-47','turn-b-811','B retained'),started:true});
 await runtime('coordinator-release',{identity,run_id:r.run.id,attempt:1,native_ref:'root-turn-r-613',outcome:'completed'});
 const s=await runtime('claim',{identity});await runtime('submitted',{identity,run_id:s.run.id,attempt:1,native_ref:'root-turn-s-997'});
 expect(custody().admitted_run_ids).toEqual([r.run.id,s.run.id]);
 expect(db.all('SELECT id,parent_run_id,status FROM runs WHERE id IN (?,?,?) ORDER BY id',a.id,b.id,s.run.id)).toEqual([
  ...[{id:a.id,parent_run_id:r.run.id,status:'running'},{id:b.id,parent_run_id:r.run.id,status:'running'},{id:s.run.id,parent_run_id:null,status:'running'}].sort((x,y)=>x.id.localeCompare(y.id)),
 ]);
 expect(await control.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'run.cancel',payload:{run_id:r.run.id,reason:'Revoke exact root R'}})).toMatchObject({ok:true,value:{status:'applied'}});
 const onlyLoadedS={id:'41000000-0000-4000-8000-000000000701',run_id:s.run.id,attempt:1,kind:'inference',status:'active',started_at:'2026-09-10T00:00:00.000Z',deadline_at:s.deadline_at,last_progress_at:'2026-09-10T00:00:00.000Z'};
 const heartbeat=await runtime('heartbeat',{identity,operations:[onlyLoadedS]});
 expect(heartbeat.cancellations).toEqual(expect.arrayContaining([r.run.id,a.id,b.id]));
 expect(heartbeat.cancellations).not.toContain(s.run.id);
 expect(db.all('SELECT id,parent_run_id,status,error_code FROM runs WHERE id IN (?,?,?) ORDER BY id',a.id,b.id,s.run.id)).toEqual([
  ...[{id:a.id,parent_run_id:r.run.id,status:'cancelling',error_code:'OWNER_CANCELLED'},{id:b.id,parent_run_id:r.run.id,status:'cancelling',error_code:'OWNER_CANCELLED'},{id:s.run.id,parent_run_id:null,status:'running',error_code:null}].sort((x,y)=>x.id.localeCompare(y.id)),
 ]);
 expect(db.all('SELECT run_id,native_run_ref,status,result_json FROM attempts WHERE run_id IN (?,?,?) ORDER BY run_id',a.id,b.id,s.run.id)).toEqual([
  ...[{run_id:a.id,native_run_ref:'turn-a-211',status:'running',result_json:null},{run_id:b.id,native_run_ref:'turn-b-811',status:'running',result_json:null},{run_id:s.run.id,native_run_ref:'root-turn-s-997',status:'running',result_json:null}].sort((x,y)=>x.run_id.localeCompare(y.run_id)),
 ]);
});
