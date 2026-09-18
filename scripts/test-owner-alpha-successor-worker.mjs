import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'hehe-owner-alpha-successor-'));let child,logs='',timer;
async function stop(){clearTimeout(timer);if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function start(){
 const policy={session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',persona_id:'11111111-1111-4111-8111-111111111111',expires_at:'2026-09-17T00:01:00.000Z',max_runs:1,max_task_seconds:30};
 const config=join(directory,'wrangler.json');await writeFile(config,JSON.stringify({name:'hehe-owner-alpha-successor-test',main:new URL('../tests/owner-alpha-successor-worker.ts',import.meta.url).pathname,compatibility_date:'2026-09-10',compatibility_flags:['nodejs_compat'],vars:{FIXTURE_NOW:'2026-09-17T00:00:00.000Z',AUTH_MODE:'local',INSTALLATION_ID:'successor-fixture',OWNER_SUB:'fixture-owner',ACCESS_ISSUER:'',ACCESS_AUD:'',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',HEHEBOT_OWNER_ALPHA:JSON.stringify(policy),ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',NATIVE_DELEGATIONS:'{}',FLIGHT_RESTORE_VERIFIED:'false'},durable_objects:{bindings:[{name:'DB',class_name:'OwnerAlphaSuccessorWorker'}]},migrations:[{tag:'v1',new_sqlite_classes:['OwnerAlphaSuccessorWorker']}],rules:[{type:'Text',globs:['**/*.sql'],fallthrough:true}]}));
 child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--ip','127.0.0.1','--port','0','--persist-to',join(directory,'state')],{env:{PATH:process.env.PATH,HOME:directory,WRANGLER_LOG_PATH:join(directory,'logs'),WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 let startup='';for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{logs+=x;startup+=x;});timer=setTimeout(()=>child.kill('SIGTERM'),60000);
 return new Promise((resolve,reject)=>{const poll=setInterval(()=>{const match=startup.replace(/\u001b\[[0-9;]*m/g,'').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearInterval(poll);resolve(match[1]);}},100);child.once('error',error=>{clearInterval(poll);reject(error);});child.once('exit',()=>{clearInterval(poll);reject(Error('Worker stopped before ready'));});});
}
async function request(base,path,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text);}
try{
 const base=await start(),prepared=await request(base,'/prepare',{}),query=`?run=${prepared.runId}&queued=${prepared.queuedId}`,before=prepared.before;
 assert.equal(before.run[0].status,'recovery_required');assert.equal(before.effect[0].status,'outcome_unknown');assert.equal(before.retry.length,1);assert.equal(before.queued[0].status,'waiting');
 assert.equal(prepared.rejected.ok,true);assert.equal(prepared.rejected.value.status,'rejected');assert.equal(prepared.rejected.value.error.code,'FORBIDDEN');
 assert.deepEqual(prepared.afterRejected,{...prepared.beforeRejected,retained:before});
 assert.equal(prepared.activation.ok,true);assert.equal(prepared.activation.value.status,'applied');assert.equal(prepared.activation.value.resource_id,prepared.generation.transition_id);assert.deepEqual(prepared.retained,before);
 const wake=await request(base,'/hosted-wake'+query,{});
 assert.equal(wake.alarmAfterReads,wake.earliestAlarm,'owner reads must not postpone the staged wake/watchdog alarm');
 assert.deepEqual(wake.before,wake.after);assert.deepEqual(wake.before.retained,before);
 assert.deepEqual(wake.deliveries,[{url:'https://hehebot-fixture.sprites.app/wake',body:JSON.stringify({epoch:2,operationId:prepared.generation.transition_id})}]);
 assert.deepEqual(wake.intent,{epoch:2,boot_id:prepared.generation.boot_id,transition_id:prepared.generation.transition_id,status:'queued'});
 assert.ok(wake.alarm>Date.now());assert.ok(wake.alarm<=Date.now()+7000);
 const p=prepared.command.payload,reordered=` { "payload" : { "envelope_sha256" : "${p.envelope_sha256}", "transition_id" : "${p.transition_id}" }, "type" : "owner-alpha.activate", "schema_version" : 1 } `;
 const retryResponse=await fetch(base+'/retry-activation'+query,{method:'POST',headers:{'content-type':'application/json','idempotency-key':prepared.key},body:reordered,signal:AbortSignal.timeout(15000)});
 const retryText=await retryResponse.text();assert.equal(retryResponse.status,200,retryText);const retry=JSON.parse(retryText);
 assert.deepEqual(retry.result,prepared.activation);assert.deepEqual(retry.retained,before);
 const read=await request(base,'/read'+query);assert.deepEqual(read.retained,before);assert.equal(read.result.ok,true);assert.ok(read.alarm>Date.now());assert.ok(read.alarm<=Date.now()+7000);
 const fresh={schema_version:1,type:'message.send',payload:{conversation_id:prepared.persona,text:'fresh successor input'}};
 const accepted=await request(base,'/accept'+query,fresh);assert.equal(accepted.result.ok,true);assert.equal(accepted.result.value.status,'applied');assert.deepEqual(accepted.retained,before);
 const status=await request(base,'/status');assert.equal(status.ok,true);assert.deepEqual(status.value.owner_alpha_generation,prepared.generation);assert.deepEqual(Object.keys(status.value.owner_alpha_generation).sort(),['boot_id','epoch','transition_id']);
 const alarm=await request(base,'/alarm'+query,{now:'2026-09-17T00:04:00.000Z'});assert.equal(alarm.lifecycle.phase,'RECOVERY_REQUIRED');assert.equal(alarm.lifecycle.epoch,2);assert.equal(alarm.lifecycle.boot_id,prepared.generation.boot_id);assert.deepEqual(alarm.retained,before);assert.equal(alarm.alarm,null);
 const second=await request(base,'/alarm'+query,{now:'2026-09-17T00:05:00.000Z'});assert.deepEqual(second.retained,before);assert.equal(second.alarm,null);assert.equal(second.lifecycle.phase,'RECOVERY_REQUIRED');
 await stop();
 const reopened=await start();
 const afterRestart=await request(reopened,'/alarm'+query,{now:'2026-09-17T00:05:00.000Z'});
 assert.deepEqual(afterRestart.retained,before);assert.equal(afterRestart.alarm,null);assert.deepEqual(afterRestart.lifecycle,second.lifecycle);
 assert.deepEqual((await request(reopened,'/status')).value.owner_alpha_generation,prepared.generation);
 const continuation=await request(reopened,'/continue'+query,{});
 assert.equal(continuation.result.ok,true);assert.equal(continuation.result.value.status,'applied');assert.deepEqual(continuation.retained,before);
 assert.deepEqual((await request(reopened,'/status')).value.owner_alpha_generation,continuation.generation);
 await stop();
 const thirdOpen=await start();
 assert.deepEqual((await request(thirdOpen,'/status')).value.owner_alpha_generation,continuation.generation);
 const thirdAlarm=await request(thirdOpen,'/alarm'+query,{now:'2026-09-17T00:12:00.000Z'});
 assert.equal(thirdAlarm.lifecycle.epoch,3);assert.equal(thirdAlarm.lifecycle.phase,'RECOVERY_REQUIRED');assert.deepEqual(thirdAlarm.retained,before);
 assert.ok(!logs.includes('control.alarm_failed'));
 console.log('PASS real workerd SQLite: actual PersonalControl.accept owner-alpha activation and canonical same-key retry preserve predecessor run, attempt, unknown effect, overdue retry, queued context, command and alpha bytes.');
 console.log('PASS actual PersonalControl.alarm hosted wake: two alarms make one exact captured notification through a fixture transport, record the queued intent, preserve lifecycle/predecessor custody, and retain watchdog cadence.');
 console.log('PASS generation watchdog: epoch 2 lease expiry transitions to RECOVERY_REQUIRED, deletes alarm, and retired due timestamps do not spin; status exposes exact three-field descriptor.');
 console.log('PASS persisted Worker reopen: exact predecessor custody, successor lifecycle/descriptor and absent alarm retained without replay.');
 console.log('PASS epoch 3 continuation of unused expired epoch 2: activation, second reopen and watchdog retain epoch 1 unknown custody unchanged.');
 console.log('LIMIT successor grant and retirement-receipt digest are synthetic loopback fixture inputs, not real retirement evidence; no public activation/config, inference, provider, auth account, or credential call.');
}catch(error){console.error(logs.slice(-6000));throw error;}finally{await stop();await rm(directory,{recursive:true,force:true});}
