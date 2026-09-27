import {createHash,createHmac,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TestDatabase,bot,otherBot,routine} from './helpers';
import {PersonalControl} from '../src/worker/control-object';
import worker from '../src/worker/index';
import {parseOwnerAlpha,type OwnerAlphaPolicy} from '../src/core/owner-alpha';
import {Store} from '../src/core/store';
import {ROUTINE_MANAGE_POLICY} from '../src/core/agent-commands';

vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../DB/schema.sql',()=>({default:''}));
const origin='http://127.0.0.1',token='synthetic-owner-alpha-token';
const base={AUTH_MODE:'local',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}'};
let db:TestDatabase,control:PersonalControl,env:Env,policy:OwnerAlphaPolicy;
const network=vi.fn(()=>{throw new Error('Unexpected provider/network call');});
const setAlarm=vi.fn(async()=>{});
async function initialize(config:OwnerAlphaPolicy|null=policy){
 let initialized:Promise<unknown>=Promise.resolve();
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>db.transaction(fn),getAlarm: async () => null,setAlarm,deleteAlarm:async()=>{}},blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
 env={...base,HEHEBOT_OWNER_ALPHA:config?JSON.stringify(config):undefined,INSTALLATION_ID:'local-only',OWNER_SUB:'local-owner',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:JSON.stringify([ROUTINE_MANAGE_POLICY]),TRIGGER_CONFIG:'{}',RUNTIME_TOKEN:token,CONTROL:{getByName:()=>control}} as unknown as Env;
 control=new PersonalControl(ctx as unknown as DurableObjectState,env);await initialized;
}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
 vi.stubGlobal('fetch',network);network.mockClear();setAlarm.mockClear();db=new TestDatabase();
 policy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:2,max_task_seconds:45};
});
afterEach(()=>{expect(network).not.toHaveBeenCalled();db.close();vi.useRealTimers();vi.unstubAllGlobals();});
async function request(path:string,payload:unknown,bearer=token,host=origin){
 return worker.fetch(new Request(host+path,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json',Origin:host,'Idempotency-Key':randomUUID()},body:JSON.stringify(payload)}),env);
}
async function runtime(type:string,payload:unknown){const response=await request('/internal/'+type,payload);expect(response.status).toBe(200);return response.json() as Promise<any>;}
async function command(type:string,payload:unknown){const response=await request('/v1/commands',{schema_version:1,type,payload});expect(response.status).toBe(202);return response.json() as Promise<any>;}
const message=(persona=bot)=>command('message.send',{conversation_id:persona,text:'Synthetic bounded owner request'});
async function boot(){const identity=await runtime('boot',{boot_id:randomUUID()});expect(identity.epoch).toBe(1);await runtime('ready',{identity});return identity;}
const custody=()=>JSON.parse(db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha'")[0].value_json);

it('validates alpha attempt custody without returning retained result bodies',async()=>{
 await initialize();const identity=await boot();await message();
 const claim=await runtime('claim',{identity});
 const result=JSON.stringify({text:'界'.repeat(400000)});
 db.exec('UPDATE attempts SET result_json=? WHERE run_id=?',result,claim.run.id);
 const read=vi.spyOn(db,'all');
 try{
  await runtime('submitted',{identity,run_id:claim.run.id,attempt:1,native_ref:'projected-receipt'});
  const validation=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM attempts WHERE run_id=? AND attempt=?')&&
   (sql.includes('submission_key')||sql.startsWith('SELECT *'))?[read.mock.results[index].value]:[]);
  expect(validation.length).toBeGreaterThan(0);
  for(const rows of validation)for(const row of rows){
   expect(Object.keys(row).sort()).toEqual(['boot_id','deadline_at','epoch','native_run_ref','started_at','submission_key']);
   expect(row).toMatchObject({epoch:identity.epoch,boot_id:identity.boot_id,submission_key:`${claim.run.id}:1`});
  }
 }finally{read.mockRestore();}
 expect(db.all('SELECT result_json,native_run_ref,status FROM attempts WHERE run_id=?',claim.run.id))
  .toEqual([{result_json:result,native_run_ref:'projected-receipt',status:'running'}]);
});

it('defaults off and keeps normal runtime admission disabled',async()=>{
 await initialize(null);
 expect(await runtime('status',{})).toEqual({phase:'STOPPED',epoch:0,execution_enabled:false});
 expect((await request('/internal/boot',{boot_id:randomUUID()})).status).toBe(409);
 const receipt=await message();expect(db.all('SELECT status FROM runs WHERE id=?',receipt.resource_id)).toEqual([{status:'waiting'}]);
 expect(db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")).toEqual([]);
});

it('does not grant staged alpha access to ordinary memory preparation',async()=>{
 await initialize();const receipt=await message(),identity=await boot();
 const before=db.all('SELECT * FROM runs');
 const response=await request('/internal/memory-prepare',{identity,persona_models:{[bot]:'gpt-5.4'}});
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
 expect(db.all('SELECT * FROM runs')).toEqual(before);
 expect(db.all('SELECT * FROM attempts')).toEqual([]);
 expect(db.all('SELECT status FROM runs WHERE id=?',receipt.resource_id)).toEqual([{status:'queued'}]);
});

it.each([null,{},[],{extra:true},{max_runs:0},{max_runs:4},{max_runs:1.5},{max_task_seconds:0},{max_task_seconds:301},{max_task_seconds:'3'},{session_id:'bad'},{persona_id:'bad'},{expires_at:'2026-09-10T00:01:00Z'},{expires_at:'2026-09-10T08:01:00.000+08:00'},{expires_at:'2026-02-30T00:00:00.000Z'}])('rejects invalid policy %j',invalid=>{
 const value=invalid&&typeof invalid==='object'&&!Array.isArray(invalid)&&Object.keys(invalid).length?{...policy,...invalid}:invalid;
 expect(()=>parseOwnerAlpha(JSON.stringify(value),base)).toThrow();
});
it('requires local auth, both false gates, and no provider',()=>{
 expect(parseOwnerAlpha(undefined,base)).toBeUndefined();expect(parseOwnerAlpha('',base)).toBeUndefined();
 expect(()=>parseOwnerAlpha('{',base)).toThrow();
 for(const change of [{AUTH_MODE:'access'},{EXECUTION_ENABLED:'true'},{NATIVE_VERIFIED:'true'},{PROVIDER_CONFIG:'{"ref":{}}'},{PROVIDER_CONFIG:'null'}])expect(()=>parseOwnerAlpha(JSON.stringify(policy),{...base,...change})).toThrow();
 expect(parseOwnerAlpha(JSON.stringify(policy),base)).toEqual(policy);
});

it('exposes exact policy, authenticates boot/owner ingress and queues only private direct owner messages',async()=>{
 await initialize();
 expect(await runtime('status',{})).toEqual({phase:'STOPPED',epoch:0,execution_enabled:false,owner_alpha:policy});
 expect((await request('/internal/boot',{boot_id:randomUUID()},'wrong')).status).toBe(401);
 expect((await request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'remote'}},token,'https://not-loopback.invalid')).status).toBe(401);
 const right=await message(),wrong=await message(otherBot),room=randomUUID();
 await command('room.put',{id:room,expected_revision:0,name:'Synthetic room',member_ids:[bot,otherBot],default_responder_id:bot});
 const roomMessage=await message(room),r=routine();await command('routine.put',r);const routineRun=await command('routine.run',{id:r.id,expected_revision:1});
 const trigger=randomUUID(),tr=routine({schedule:null,trigger_source_id:trigger});
 new Store(db).put(trigger,'trigger',{routine_id:tr.id,event_types:['mail']},0,'operator',new Date().toISOString());
 expect(await command('routine.put',tr)).toMatchObject({status:'applied'});
 const secret='synthetic-trigger-secret',timestamp=String(Date.now()/1000),body=JSON.stringify({schema_version:1,type:'mail',data:{text:'Untrusted source requests execution'}});
 env.TRIGGER_SECRETS=JSON.stringify({[trigger]:secret});
 const signature=createHmac('sha256',secret).update(`${timestamp}\nevent\n${body}`).digest('hex');
 const triggered=await worker.fetch(new Request(origin+'/v1/triggers/'+trigger,{method:'POST',headers:{'Content-Type':'application/json','X-Timestamp':timestamp,'X-Event-ID':'event','X-Signature':signature},body}),env);
 expect(triggered.status).toBe(202);expect(await triggered.json()).toMatchObject({status:'applied'});
 for(const receipt of [wrong,roomMessage,routineRun])expect(db.all('SELECT status FROM runs WHERE id=?',receipt.resource_id)).toEqual([{status:'waiting'}]);
 expect(db.all('SELECT status FROM runs WHERE routine_id=?',tr.id)).toEqual([{status:'waiting'}]);
 expect(db.all('SELECT status FROM runs WHERE id=?',right.resource_id)).toEqual([{status:'queued'}]);
 const identity=await boot(),claimed=await runtime('claim',{identity});expect(claimed.run.id).toBe(right.resource_id);
 expect(claimed.deadline_at).toBe('2026-09-10T00:00:45.000Z');
 expect(await runtime('claim',{identity})).toBeNull();
 await control.alarm();expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
 expect(await runtime('status',{})).toMatchObject({phase:'READY',execution_enabled:false,owner_alpha:policy});
});

it('counts independent claims atomically across reconstruction, not repeated callbacks or queued messages',async()=>{
 await initialize();const identity=await boot();
 await message();await message();await message();
 const first=await runtime('claim',{identity}),scope={identity,run_id:first.run.id,attempt:1,native_ref:'native:first'};
 await runtime('submitted',scope);await runtime('submitted',scope);
 await runtime('coordinator-release',{...scope,outcome:'completed'});await runtime('coordinator-release',{...scope,outcome:'completed'});
 expect(custody().admitted_run_ids).toEqual([first.run.id]);
 await initialize();
 const second=await runtime('claim',{identity});expect(second.run.id).not.toBe(first.run.id);
 await runtime('submitted',{identity,run_id:second.run.id,attempt:1,native_ref:'native:second'});
 await runtime('coordinator-release',{identity,run_id:second.run.id,attempt:1,native_ref:'native:second',outcome:'completed'});
 await initialize();expect(await runtime('claim',{identity})).toBeNull();
 expect(custody().admitted_run_ids).toEqual([first.run.id,second.run.id]);
 const extra=await message();expect(db.all('SELECT status FROM runs WHERE id=?',extra.resource_id)).toEqual([{status:'waiting'}]);
 expect(db.all('SELECT attempt FROM attempts')).toEqual([{attempt:1},{attempt:1}]);
 expect(db.all('SELECT * FROM retry_queue')).toEqual([]);
});

it('bounds expiry at claim but keeps exact output/heartbeat/release and cancellation custody after expiry',async()=>{
 await initialize();const identity=await boot();await message();await message();
 vi.setSystemTime(new Date('2026-09-10T00:00:59.999Z'));
 const first=await runtime('claim',{identity});expect(first.deadline_at).toBe(policy.expires_at);
 const scope={identity,run_id:first.run.id,attempt:1},native_ref='native:expiry';await runtime('submitted',{...scope,native_ref});
 vi.setSystemTime(new Date(policy.expires_at));
 expect(await runtime('claim',{identity})).toBeNull();
 await control.alarm();expect(db.all('SELECT status,error_code FROM runs WHERE id=?',first.run.id)).toEqual([{status:'cancelling',error_code:'DEADLINE_EXCEEDED'}]);
 expect(await runtime('output-preview',{...scope,native_ref,version:1,text:'Late provisional text',truncated:false})).toEqual({accepted:true});
 expect(await control.getState('local-owner')).toMatchObject({ok:true,value:{summary:{execution_enabled:false},output_previews:[{run_id:first.run.id,text:'Late provisional text'}]}});
 expect(await runtime('heartbeat',{identity,operations:[]})).toMatchObject({cancellations:[first.run.id]});
 expect(await runtime('steer-pending',{identity,targets:[{run_id:first.run.id,attempt:1}]})).toEqual([]);
 await runtime('coordinator-release',{...scope,native_ref,outcome:'completed'});
 for(const bad of [{...scope,attempt:2},{...scope,identity:{...identity,epoch:2}},{...scope,identity:{...identity,boot_id:randomUUID()}}])expect((await request('/internal/output-preview',{...bad,native_ref,version:2,text:'wrong',truncated:false})).status).toBe(409);
 const cancelled=await command('run.cancel',{run_id:first.run.id,reason:'Owner stop'});expect(cancelled.status).toBe('applied');
 expect(await runtime('output-preview',{...scope,native_ref,version:2,text:'must not publish',truncated:false})).toEqual({accepted:false,reason:'OUTPUT_FENCED'});
 expect(await control.getState('local-owner')).toMatchObject({ok:true,value:{output_previews:[]}});
 expect(await runtime('heartbeat',{identity,operations:[]})).toMatchObject({cancellations:[first.run.id]});
 const late=await message();expect(db.all('SELECT status FROM runs WHERE id=?',late.resource_id)).toEqual([{status:'waiting'}]);
});

it('fails closed on changed/removed policy, missing custody, old epoch and unknown admission outcomes',async()=>{
 await initialize();const identity=await boot();await message();const first=await runtime('claim',{identity});
 const saved=custody();
 await expect(initialize(null)).rejects.toThrow();
 for(const changed of [{...policy,session_id:randomUUID()},{...policy,max_runs:3},{...policy,expires_at:'2026-09-10T00:02:00.000Z'},{...policy,text_only:{profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)}}])await expect(initialize(changed)).rejects.toThrow();
 expect(custody()).toEqual(saved);await initialize();
 expect((await request('/internal/boot',{boot_id:randomUUID()})).status).toBe(409);
 vi.setSystemTime(new Date('2026-09-10T00:01:31.000Z'));await control.alarm();
 expect(db.all('SELECT phase FROM lifecycle')).toEqual([{phase:'RECOVERY_REQUIRED'}]);
 expect(db.all('SELECT status,settled_at FROM attempts WHERE run_id=?',first.run.id)).toEqual([{status:'claimed',settled_at:null}]);
 expect((await request('/internal/heartbeat',{identity,operations:[]})).status).toBe(409);
 expect(db.all('SELECT * FROM retry_queue')).toEqual([]);expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
 await initialize();expect((await request('/internal/boot',{boot_id:randomUUID()})).status).toBe(409);
 db.exec("DELETE FROM runtime_metadata WHERE key='owner_alpha'");await expect(initialize()).rejects.toThrow();
});

it('denies mutating tools, children, final settlement, flight and sleep even for exact alpha attempts',async()=>{
 await initialize();const identity=await boot();await message();const first=await runtime('claim',{identity});
 const scope={identity,run_id:first.run.id,attempt:1};
 const calls:[string,unknown][]=[
  ['prepare-sleep',{identity}],['commit-sleep',{identity,stop_token:randomUUID(),queue_sequence:1,checkpoint:{ok:true}}],
  ['complete',{...scope,result:{status:'completed',text:'not verified'},text_only_receipt:{profile_version:'codex-text-only-v1',profile_sha256:'a'.repeat(64),thread_id:'thread',turn_id:'turn',output_sha256:'b'.repeat(64)}}],
  ['native-child',{identity,child:{parent_run_id:first.run.id,parent_attempt:1,persona_id:bot,native_run_ref:'child',native_session_key:'child-session',title:'Denied child'}}],
  ['resource-acquire',{...scope,resources:['synthetic']}],['resource-release',{...scope,resources:['synthetic']}],
  ['agent-command',{...scope,idempotency_key:randomUUID(),command:{schema_version:1,type:'routine.put',payload:routine()}}],
  ['effect-result',{...scope,effect_id:randomUUID(),status:'confirmed',receipt:{synthetic:true}}],
  ['flight-reconcile',{...scope}],
 ];
 for(const [type,payload] of calls){const response=await request('/internal/'+type,payload);expect(await response.json(),type).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});}
 expect(db.all('SELECT * FROM effects')).toEqual([]);expect(db.all('SELECT * FROM native_task_links')).toEqual([]);
 expect(db.all('SELECT result_json FROM attempts')).toEqual([{result_json:null}]);
});

it('completes only a freshly pinned exact text-only result and replays idempotently',async()=>{
 const text_only={profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)};
 policy={...policy,text_only};await initialize();const identity=await boot();await message();const claim=await runtime('claim',{identity});
 expect(claim.text_only).toEqual(text_only);
 const scope={identity,run_id:claim.run.id,attempt:1},native_ref='native:text-only-turn';
 await runtime('submitted',{...scope,native_ref});await runtime('coordinator-release',{...scope,native_ref,outcome:'completed'});
 const result={status:'completed' as const,text:'Exact UTF-8 result ✓'};
 const text_only_receipt={...text_only,thread_id:'native:thread',turn_id:native_ref,output_sha256:createHash('sha256').update(result.text).digest('hex')};
 await runtime('complete',{...scope,result,text_only_receipt});
 const before={attempt:db.all('SELECT status,result_json,settled_at FROM attempts'),run:db.all('SELECT status FROM runs'),outbox:db.all('SELECT payload_json,status FROM outbox'),events:db.all("SELECT payload_json FROM events WHERE type='run.result'")};
 expect(before.attempt).toEqual([{status:'completed',result_json:JSON.stringify(result),settled_at:'2026-09-10T00:00:00.000Z'}]);
 expect(before.run).toEqual([{status:'completed'}]);expect(before.outbox).toEqual([{payload_json:JSON.stringify(result),status:'delivered'}]);expect(before.events).toHaveLength(1);
 await runtime('complete',{...scope,result,text_only_receipt});
 expect({attempt:db.all('SELECT status,result_json,settled_at FROM attempts'),run:db.all('SELECT status FROM runs'),outbox:db.all('SELECT payload_json,status FROM outbox'),events:db.all("SELECT payload_json FROM events WHERE type='run.result'")}).toEqual(before);
 expect(db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`text_only_receipt:${claim.run.id}:1`).map(row=>JSON.parse(row.value_json))).toEqual([text_only_receipt]);
 expect((await request('/internal/complete',{...scope,result,text_only_receipt:{...text_only_receipt,thread_id:'different-thread'}})).status).toBe(409);
 expect(db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
});

it.each([
 ['profile',(r:any)=>({...r,profile_sha256:'b'.repeat(64)})],
 ['turn',(r:any)=>({...r,turn_id:'other-turn'})],
 ['digest',(r:any)=>({...r,output_sha256:'b'.repeat(64)})],
 ['result',(r:any)=>r],
] as const)('rejects changed text-only %s proof without persistence',async(kind,change)=>{
 const text_only={profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)};policy={...policy,text_only};await initialize();
 const identity=await boot();await message();const claim=await runtime('claim',{identity}),scope={identity,run_id:claim.run.id,attempt:1},native_ref='native:turn';
 await runtime('submitted',{...scope,native_ref});await runtime('coordinator-release',{...scope,native_ref,outcome:'completed'});
 const result={status:'completed' as const,text:kind==='result'?'changed':'exact'};
 const receipt={...text_only,thread_id:'thread',turn_id:native_ref,output_sha256:createHash('sha256').update('exact').digest('hex')};
 const response=await request('/internal/complete',{...scope,result,text_only_receipt:change(receipt)});expect(response.status).toBe(409);
 expect(db.all('SELECT result_json FROM attempts')).toEqual([{result_json:null}]);expect(db.all('SELECT * FROM outbox')).toEqual([]);
 expect(db.all("SELECT key FROM runtime_metadata WHERE key LIKE 'text_only_receipt:%'")).toEqual([]);
});

it('rejects a text-only receipt for the wrong attempt',async()=>{
 const text_only={profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)};policy={...policy,text_only};await initialize();
 const identity=await boot();await message();const claim=await runtime('claim',{identity}),native_ref='native:turn';
 await runtime('submitted',{identity,run_id:claim.run.id,attempt:1,native_ref});await runtime('coordinator-release',{identity,run_id:claim.run.id,attempt:1,native_ref,outcome:'completed'});
 const result={status:'completed',text:'exact'},text_only_receipt={...text_only,thread_id:'thread',turn_id:native_ref,output_sha256:createHash('sha256').update(result.text).digest('hex')};
 expect((await request('/internal/complete',{identity,run_id:claim.run.id,attempt:2,result,text_only_receipt})).status).toBe(409);
 expect(db.all('SELECT result_json FROM attempts')).toEqual([{result_json:null}]);
});

it('rejects text-only completion with historical children, effects, live operations or locks',async()=>{
 const text_only={profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)};
 for(const obstruction of ['child','effect','operation','lock']){
  db.close();db=new TestDatabase();policy={...policy,session_id:randomUUID(),text_only};await initialize();const identity=await boot();await message();const claim=await runtime('claim',{identity});
  const scope={identity,run_id:claim.run.id,attempt:1},native_ref='native:'+obstruction;await runtime('submitted',{...scope,native_ref});await runtime('coordinator-release',{...scope,native_ref,outcome:'completed'});
  if(obstruction==='child')db.exec("INSERT INTO runs(id,persona_id,role,parent_run_id,status,title,context_json,current_attempt,created_at,updated_at) VALUES(?,?,'background',?,'completed','old child','{}',0,?,?)",randomUUID(),bot,claim.run.id,new Date().toISOString(),new Date().toISOString());
  if(obstruction==='effect')db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'read_only','confirmed','auth','digest',?)",randomUUID(),claim.run.id,randomUUID(),new Date().toISOString());
  if(obstruction==='operation')db.exec("INSERT INTO operations(id,run_id,attempt,kind,status,started_at,deadline_at,last_progress_at) VALUES(?,?,1,'tool','active',?,?,?)",randomUUID(),claim.run.id,new Date().toISOString(),claim.deadline_at,new Date().toISOString());
  if(obstruction==='lock')db.exec('INSERT INTO resource_locks(resource_id,run_id,attempt,acquired_at) VALUES(?,?,1,?)','old-lock',claim.run.id,new Date().toISOString());
  const result={status:'completed',text:'exact'},text_only_receipt={...text_only,thread_id:'thread',turn_id:native_ref,output_sha256:createHash('sha256').update(result.text).digest('hex')};
  expect((await request('/internal/complete',{...scope,result,text_only_receipt})).status).toBe(409);expect(db.all('SELECT result_json FROM attempts')).toEqual([{result_json:null}]);
 }
});

it('rejects nonfresh epoch-zero custody and expired first boot without manufacturing an epoch',async()=>{
 await initialize(null);
 db.exec('UPDATE lifecycle SET boot_id=?',randomUUID());
 await expect(initialize()).rejects.toThrow();
 expect(db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")).toEqual([]);
 db.exec('UPDATE lifecycle SET boot_id=NULL');await initialize();
 vi.setSystemTime(new Date(policy.expires_at));
 expect((await request('/internal/boot',{boot_id:randomUUID()})).status).toBe(409);
 expect(await runtime('status',{})).toMatchObject({phase:'STOPPED',epoch:0,execution_enabled:false});
});

it('rolls back the run allowance when durable claim insertion fails',async()=>{
 await initialize();const identity=await boot();await message();
 db.sqlite.exec("CREATE TRIGGER fail_alpha_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'synthetic claim storage failure'); END");
 expect((await request('/internal/claim',{identity})).status).toBe(500);
 expect(custody().admitted_run_ids).toEqual([]);expect(db.all('SELECT status,current_attempt FROM runs')).toEqual([{status:'queued',current_attempt:0}]);
 db.sqlite.exec('DROP TRIGGER fail_alpha_attempt');
 const claim=await runtime('claim',{identity});expect(custody().admitted_run_ids).toEqual([claim.run.id]);
});

it('rechecks background and wrong-persona custody at claim even if queue status is forced',async()=>{
 await initialize();const identity=await boot(),wrong=await message(otherBot),background=await message();
 db.exec("UPDATE runs SET status='queued' WHERE id=?",wrong.resource_id);
 db.exec("UPDATE runs SET role='background' WHERE id=?",background.resource_id);
 expect(await runtime('claim',{identity})).toBeNull();expect(custody().admitted_run_ids).toEqual([]);
 const right=await message();expect((await runtime('claim',{identity})).run.id).toBe(right.resource_id);
});

it.each(['OWNER_CANCELLED','CONTEXT_INVALIDATED'] as const)('permits deadline-expired reads but fences revoked read custody for %s',async(reason)=>{
 await initialize();
 const store=new Store(db),persona=store.get(bot,'persona'),skill=randomUUID(),r=routine({enabled:false});
 expect(await command('persona.put',{...persona.body,id:bot,expected_revision:persona.revision,tool_policy_ids:[ROUTINE_MANAGE_POLICY]})).toMatchObject({status:'applied'});
 expect(await command('routine.put',r)).toMatchObject({status:'applied'});
 // Synthetic operator fixture: the normal enable command still enforces persona scope.
 store.put(skill,'skill',{name:'Pinned synthetic skill'},0,'owner',new Date().toISOString());
 expect(await command('skill.enable',{skill_id:skill,expected_skill_revision:1,persona_id:bot,enabled:true})).toMatchObject({status:'applied'});
 const identity=await boot(),source=await message(),memory=randomUUID();
 expect(await command('memory.put',{id:memory,expected_revision:0,scope:{kind:'persona',id:bot},text:'Synthetic revocable context',source_event_id:source.id,expires_at:null,sensitivity:'ordinary'})).toMatchObject({status:'applied'});
 const claim=await runtime('claim',{identity}),scope={identity,run_id:claim.run.id,attempt:1};
 await runtime('submitted',{...scope,native_ref:'native:read'});
 vi.setSystemTime(new Date(policy.expires_at));await control.alarm();
 expect(await runtime('agent-routines',scope)).toMatchObject({routines:[{id:r.id}],next_cursor:null});
 expect(await runtime('agent-skill',{...scope,skill_id:skill})).toMatchObject({skill:{id:skill,revision:1,body:{name:'Pinned synthetic skill'}}});
 expect(await command('run.steer',{run_id:claim.run.id,expected_attempt:1,text:'not allowed'})).toMatchObject({status:'rejected',error:{code:'CAPABILITY_UNAVAILABLE'}});
 expect(await runtime('steer-pending',{identity,targets:[{run_id:claim.run.id,attempt:1}]})).toEqual([]);
 expect((await request('/internal/agent-routines',{...scope,attempt:2})).status).toBe(409);
 const revoke=reason==='OWNER_CANCELLED'?await command('run.cancel',{run_id:claim.run.id,reason:'Owner revoked access'}):await command('memory.delete',{id:memory,expected_revision:1,purge_transcripts:false});
 expect(revoke).toMatchObject({status:'applied'});
 expect(db.all('SELECT status,error_code FROM runs WHERE id=?',claim.run.id)).toEqual([{status:'cancelling',error_code:reason}]);
 for(const status of ['cancelling','interrupted']){
  expect(db.all('SELECT status FROM runs WHERE id=?',claim.run.id)).toEqual([{status}]);
  for(const [type,payload] of [['agent-routines',scope],['agent-skill',{...scope,skill_id:skill}]] as const){
   const response=await request('/internal/'+type,payload);expect(response.status).toBe(409);
   expect(await response.json()).toMatchObject({error:{code:'REVISION_CONFLICT'}});
  }
  await runtime('heartbeat',{identity,operations:[]});
  vi.setSystemTime(new Date(Date.now()+30000));await control.alarm();
 }
});

it('preserves unknown operation custody after deadlines and never retries an admitted run',async()=>{
 await initialize();const identity=await boot();await message();const claim=await runtime('claim',{identity});
 const scope={identity,run_id:claim.run.id,attempt:1};await runtime('submitted',{...scope,native_ref:'native:unknown'});
 const operation={id:randomUUID(),run_id:claim.run.id,attempt:1,kind:'inference',status:'unknown',started_at:'2026-09-10T00:00:00.000Z',deadline_at:claim.deadline_at,last_progress_at:'2026-09-10T00:00:00.000Z'};
 await runtime('heartbeat',{identity,operations:[operation]});
 vi.setSystemTime(new Date('2026-09-10T00:00:45.000Z'));await control.alarm();
 vi.setSystemTime(new Date('2026-09-10T00:01:15.000Z'));await control.alarm();
 expect(db.all('SELECT status,error_code FROM runs')).toEqual([{status:'interrupted',error_code:'CANCEL_UNCONFIRMED'}]);
 expect(db.all('SELECT status FROM operations')).toEqual([{status:'unknown'}]);
 expect(await runtime('heartbeat',{identity,operations:[operation]})).toMatchObject({cancellations:[claim.run.id]});
 expect(await command('run.retry',{run_id:claim.run.id,expected_attempt:1})).toMatchObject({status:'rejected',error:{code:'CANCEL_UNCONFIRMED'}});
 expect(db.all('SELECT * FROM retry_queue')).toEqual([]);expect(db.all('SELECT attempt FROM attempts')).toEqual([{attempt:1}]);
});

it('retains a late submission receipt after watchdog expiry without reviving cancelled custody',async()=>{
 await initialize();const identity=await boot();await message();const claim=await runtime('claim',{identity});
 vi.setSystemTime(new Date(policy.expires_at));await control.alarm();
 const before=db.all('SELECT * FROM runs'),scope={identity,run_id:claim.run.id,attempt:1,native_ref:'native:late-ack'};
 await runtime('submitted',scope);await runtime('submitted',scope);
 expect(db.all('SELECT * FROM runs')).toEqual(before);
 expect(db.all('SELECT native_run_ref,status FROM attempts')).toEqual([{native_run_ref:'native:late-ack',status:'running'}]);
 await runtime('coordinator-release',{...scope,outcome:'interrupted'});
 expect(await runtime('heartbeat',{identity,operations:[]})).toMatchObject({cancellations:[claim.run.id]});
 expect(custody().admitted_run_ids).toEqual([claim.run.id]);
});

it('rejects mismatched persisted epoch and consumed-run history on reconstruction',async()=>{
 await initialize();db.exec('UPDATE lifecycle SET epoch=2');await expect(initialize()).rejects.toThrow();
 db.exec('UPDATE lifecycle SET epoch=0');const identity=await boot();await message();const claim=await runtime('claim',{identity});
 const saved=custody();db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha'",JSON.stringify({...saved,admitted_run_ids:[]}));
 await expect(initialize()).rejects.toThrow();
 expect(db.all('SELECT run_id FROM attempts')).toEqual([{run_id:claim.run.id}]);
});
