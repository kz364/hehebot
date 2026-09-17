import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'hehe-routine-capacity-'));
let child,logs='',timer;
async function stop(){
 clearTimeout(timer);
 if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
}
async function start(now){
 const config=join(directory,'wrangler.json');
 await writeFile(config,JSON.stringify({name:'hehe-routine-capacity-test',main:new URL('../tests/routine-capacity-worker.ts',import.meta.url).pathname,compatibility_date:'2026-09-10',compatibility_flags:['nodejs_compat'],vars:{FIXTURE_NOW:now,AUTH_MODE:'local',INSTALLATION_ID:'capacity-fixture',OWNER_SUB:'fixture-owner',ACCESS_ISSUER:'',ACCESS_AUD:'',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',NATIVE_DELEGATIONS:'{}',FLIGHT_RESTORE_VERIFIED:'false'},durable_objects:{bindings:[{name:'DB',class_name:'RoutineCapacity'}]},migrations:[{tag:'v1',new_sqlite_classes:['RoutineCapacity']}],rules:[{type:'Text',globs:['**/*.sql'],fallthrough:true}]}));
 child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--ip','127.0.0.1','--port','0','--persist-to',join(directory,'state')],{env:{PATH:process.env.PATH,HOME:directory,WRANGLER_LOG_PATH:join(directory,'logs'),WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 let startup='';for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{logs+=x;startup+=x;});
 timer=setTimeout(()=>child.kill('SIGTERM'),60000);
 return new Promise((resolve,reject)=>{
  const poll=setInterval(()=>{const match=startup.replace(/\u001b\[[0-9;]*m/g,'').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearInterval(poll);resolve(match[1]);}},100);
  child.once('error',error=>{clearInterval(poll);reject(error);});
  child.once('exit',()=>{clearInterval(poll);reject(Error('Capacity Worker stopped before ready'));});
 });
}
async function request(base,path,body){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text);
}
async function command(base,type,payload){const result=await request(base,'/command',{schema_version:1,type,payload});assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
function quiet(snapshot,next){
 assert.equal(snapshot.execution_enabled,false);assert.equal(snapshot.native_verified,'false');
 for(const table of ['attempts','effects','outbox'])assert.deepEqual(snapshot.tables[table],[]);
 const life=snapshot.tables.lifecycle[0];assert.equal(life.phase,'STOPPED');assert.equal(life.desired_state,'STOP');assert.equal(life.queue_sequence,0);
 assert.equal(snapshot.alarm,Date.parse(next),'Real arm() must schedule the next quarter-hour, not a retry or wall-clock spin');
 assert.deepEqual([...new Set(snapshot.tables.schedule_state.map(x=>x.next_due_at))],[next]);
 assert.ok(!logs.includes('control.alarm_failed'),'The real alarm handler logged reconciliation failure');
}
try{
 let base=await start('2099-09-10T00:00:00.000Z');
 const seeded=await request(base,'/snapshot'),personas=seeded.tables.objects.filter(x=>x.kind==='persona').slice(0,2);
 assert.equal(personas.length,2);
 const routines=Array.from({length:20},(_,i)=>({id:randomUUID(),expected_revision:0,persona_id:personas[i<13?0:1].id,name:`Capacity ${i}`,instructions:`Synthetic input ${i}; read only.`,schedule:{cron:'*/15 * * * *',timezone:'UTC'},trigger_source_id:null,enabled:true,policy:{misfire:'coalesce',overlap:i<13?'queue_one':'skip',max_replay:1,max_lateness_seconds:86400},action_policy_ids:[]}));
 for(const routine of routines)assert.equal((await command(base,'routine.put',routine)).status,'applied');
 const before=await request(base,'/snapshot'),extra={...routines[19],id:randomUUID(),name:'Disabled draft'};
 const rejected=await command(base,'routine.put',extra);assert.equal(rejected.status,'rejected');assert.equal(rejected.error.code,'INVALID_INPUT');
 assert.deepEqual(await request(base,'/snapshot'),before,'21st routine must not change objects/history/schedules/runs/lifecycle/alarm');
 assert.equal((await command(base,'routine.put',{...extra,enabled:false})).status,'applied');
 const draft=await request(base,'/snapshot');
 assert.equal(draft.tables.objects.filter(x=>x.kind==='routine').length,21);
 assert.equal(draft.tables.schedule_state.length,20);
 assert.deepEqual(personas.map(p=>draft.tables.objects.filter(x=>x.kind==='routine'&&JSON.parse(x.body_json).enabled&&JSON.parse(x.body_json).persona_id===p.id).length),[13,7]);
 assert.deepEqual(draft.tables.runs,[]);
 quiet(draft,'2099-09-10T00:15:00.000Z');
 console.log('PASS admission: real accept(), 20 enabled across 13/7 personas; 21st atomic rejection; disabled draft accepted.');
 const first=await request(base,'/alarm',{now:'2099-09-10T03:00:00.000Z'});
 assert.equal(first.tables.occurrences.length,20);assert.equal(first.tables.runs.length,20);
 for(const routine of routines){
  const occurrence=first.tables.occurrences.find(x=>x.routine_id===routine.id),run=first.tables.runs.find(x=>x.routine_id===routine.id);
  assert.equal(occurrence.origin,'scheduled');assert.equal(occurrence.nominal_due_at,'2099-09-10T03:00:00.000Z');assert.equal(occurrence.coalesced_count,11);assert.equal(occurrence.status,'queued');
  assert.equal(run.occurrence_id,occurrence.id);assert.equal(run.persona_id,routine.persona_id);assert.equal(run.status,'waiting');assert.equal(run.error_code,'CAPABILITY_UNAVAILABLE');assert.equal(run.current_attempt,0);
  const context=JSON.parse(run.context_json);assert.equal(context.routine.id,routine.id);assert.equal(context.routine.revision,1);assert.equal(context.persona.id,routine.persona_id);assert.equal(context.instruction,routine.instructions);
 }
 quiet(first,'2099-09-10T03:15:00.000Z');
 assert.deepEqual(await request(base,'/alarm',{now:first.now}),first,'Duplicate handler preserves every read-back row and exact context bytes');
 console.log('PASS first alarm: explicitly invoked real handler; 12 ticks coalesce to 20 occurrences/runs, 11 omitted each, exact duplicate identity/context retention.');
 const second=await request(base,'/alarm',{now:'2099-09-10T03:30:00.000Z'});
 assert.equal(second.tables.occurrences.length,40);assert.equal(second.tables.runs.length,33);
 for(let i=0;i<20;i++){
  const routine=routines[i],old=first.tables.runs.find(x=>x.routine_id===routine.id),retained=second.tables.runs.find(x=>x.id===old.id);
  const occurrences=second.tables.occurrences.filter(x=>x.routine_id===routine.id).sort((a,b)=>a.nominal_due_at.localeCompare(b.nominal_due_at));
  assert.equal(occurrences[0].id,old.occurrence_id);assert.equal(occurrences[0].status,i<13?'skipped':'queued');
  assert.equal(occurrences[1].nominal_due_at,'2099-09-10T03:30:00.000Z');assert.equal(occurrences[1].coalesced_count,1);assert.equal(occurrences[1].status,i<13?'queued':'skipped');
  assert.equal(retained.context_json,old.context_json);
  const active=second.tables.runs.filter(x=>x.routine_id===routine.id&&x.status!=='cancelled');assert.equal(active.length,1);
  if(i<13){assert.equal(retained.status,'cancelled');assert.notEqual(active[0].id,old.id);assert.equal(active[0].occurrence_id,occurrences[1].id);}
  else assert.deepEqual(retained,old);
  assert.equal(active[0].status,'waiting');assert.equal(active[0].error_code,'CAPABILITY_UNAVAILABLE');assert.equal(active[0].current_attempt,0);
 }
 quiet(second,'2099-09-10T03:45:00.000Z');
 assert.deepEqual(await request(base,'/alarm',{now:second.now}),second);
 console.log('PASS second alarm: 13 queue_one replacements, seven skip identities retained; 40 occurrences/33 runs, no attempts/effects/outbox or execution.');
 await stop();base=await start(second.now);
 assert.deepEqual(await request(base,'/snapshot'),second,'Reopened actual PersonalControl storage before any new due time');
 const reopened=await request(base,'/alarm',{now:second.now});assert.deepEqual(reopened,second);quiet(reopened,'2099-09-10T03:45:00.000Z');
 console.log('PASS persisted restart: Wrangler stopped/reopened same disposable SQLite; exact rows/IDs/context/alarm retained before and after real handler rerun. Gates false; no credentials/provider/model calls. Timed/hosted alarm delivery is NOT tested.');
}catch(error){console.error(logs.slice(-6000));throw error;}
finally{await stop();await rm(directory,{recursive:true,force:true});}
