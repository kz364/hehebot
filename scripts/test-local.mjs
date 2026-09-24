import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { importControlExport } from './import-control-export.mjs';
import { verifyControl } from './backup-control.mjs';
await import('./test-schema-migration.mjs');
await import('./test-routine-capacity-worker.mjs');
const directory=await mkdtemp(join(tmpdir(),'hehe-worker-test-'));
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--env','local','--ip','127.0.0.1','--port','0','--persist-to',directory],{env:{...process.env,WRANGLER_LOG_PATH:join(directory,'logs'),WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>{logs+=x.toString();});child.stderr.on('data',x=>{logs+=x.toString();});
const timeout=setTimeout(()=>child.kill('SIGTERM'),45000);
try{
 const base=await new Promise((resolve,reject)=>{
  const timer=setInterval(()=>{const match=logs.replace(/\u001b\[[0-9;]*m/g,'').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearInterval(timer);resolve(match[1]);}},100);
  child.once('exit',()=>{clearInterval(timer);reject(new Error('Worker stopped before ready:\n'+logs.slice(-4000)));});
 });
 let checks=0;
 async function get(path){const r=await fetch(base+path);const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));checks++;return value;}
 async function send(type,payload,key=crypto.randomUUID(),origin=base){const r=await fetch(base+'/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'Origin':origin},body:JSON.stringify({schema_version:1,type,payload})});return {status:r.status,value:await r.json()};}
 const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/Hehebot — your assistants/);assert.match(html.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);checks++;
 const initial=await get('/v1/state');assert.equal(initial.objects.filter(x=>x.kind==='persona').length,3);assert.equal(initial.summary.execution_enabled,false);
 const connectors=await get('/v1/connectors/catalog');assert.equal(connectors.scope,'bundled-diagnostic-baseline');assert.equal(connectors.runtime_inventory,'unobserved');assert.equal(connectors.authority,'not-granted');
 assert.equal(connectors.catalog.whatsapp.protocol.whatsapp_get_chat_messages,'incompatible');assert.equal(connectors.catalog.whatsapp.protocol.whatsapp_search_messages,'synthetic-verified');assert.equal(connectors.catalog.whatsapp.evidence.installed,false);
 const bot=initial.objects.find(x=>x.kind==='persona').id;
 const recovery=await get(`/v1/conversations/${bot}/recovery`);assert.deepEqual(recovery,{runs:[],recovery:[],next_cursor:null});
 for(const query of ['after=invalid','limit=101','limit=0']){const response=await fetch(base+`/v1/conversations/${bot}/recovery?${query}`);assert.equal(response.status,422);assert.equal((await response.json()).error.code,'INVALID_INPUT');checks++;}
 const key=crypto.randomUUID(),payload={conversation_id:bot,text:'Please remember: prefer a concise morning briefing.'};
 const sent=await send('message.send',payload,key);assert.equal(sent.status,202);assert.equal(sent.value.status,'applied');checks++;
 const duplicate=await send('message.send',payload,key);assert.equal(duplicate.value.id,sent.value.id);checks++;
 const conflict=await send('message.send',{...payload,text:'Different'},key);assert.equal(conflict.status,409);assert.equal(conflict.value.error.code,'IDEMPOTENCY_CONFLICT');checks++;
 const receipt=await get('/v1/receipts/'+sent.value.id);assert.equal(receipt.resource_id,sent.value.resource_id);
 const state=await get('/v1/state');assert.equal(state.runs.length,1);assert.equal(state.runs[0].status,'waiting');assert.equal(state.summary.phase,'STOPPED');
 const history=await get(`/v1/conversations/${bot}/events`);const source=history.events.find(x=>x.type==='message.user').id;
 const memory=await send('memory.put',{id:crypto.randomUUID(),expected_revision:0,scope:{kind:'global',id:null},text:'Prefer concise morning briefings.',source_event_id:source,expires_at:null,sensitivity:'ordinary'});assert.equal(memory.value.status,'applied');checks++;
 const originalMemory=(await get('/v1/state')).objects.find(x=>x.id===memory.value.resource_id);
 const declared=await send('memory.put',{...originalMemory.body,expected_revision:1,explicit_constraint:true});assert.equal(declared.value.status,'applied');checks++;
 const legacyEdit=await send('memory.put',{...originalMemory.body,expected_revision:2,text:'Never send a morning briefing without approval.'});assert.equal(legacyEdit.value.status,'applied');checks++;
 const retained=(await get('/v1/state')).objects.find(x=>x.id===memory.value.resource_id);assert.equal(retained.revision,3);assert.equal(retained.body.explicit_constraint,true);assert.equal(retained.body.text,'Never send a morning briefing without approval.');
 const routine={id:crypto.randomUUID(),expected_revision:0,persona_id:bot,name:'Morning briefing',instructions:'Summarize the day. Do not send messages.',schedule:{cron:'0 8 * * 1-5',timezone:'Asia/Jakarta'},trigger_source_id:null,enabled:true,policy:{misfire:'coalesce',overlap:'queue_one',max_replay:1,max_lateness_seconds:86400},action_policy_ids:[]};
 const saved=await send('routine.put',routine);assert.equal(saved.value.status,'applied');checks++;
 const invalid=await send('routine.put',{...routine,expected_revision:1,schedule:{...routine.schedule,cron:'* * * * *'}});assert.equal(invalid.value.status,'rejected');assert.equal(invalid.value.error.code,'INVALID_INPUT');checks++;
 const after=await get('/v1/state');assert.equal(after.objects.find(x=>x.id===routine.id).revision,1);
 const roomId=crypto.randomUUID();const room=await send('room.put',{id:roomId,expected_revision:0,name:'Planning',member_ids:[bot],default_responder_id:bot});assert.equal(room.value.status,'applied');
 const context=await send('room.publish',{room_id:roomId,kind:'context_update',recipient_ids:[bot],text:'A preference changed.',references:[],cause_id:crypto.randomUUID()});assert.equal(context.value.status,'applied');checks++;
 const noOp=await get('/v1/state');assert.equal(noOp.runs.length,1);assert.equal(noOp.summary.phase,'STOPPED');
 const draft={schema_version:1,type:'routine.put',payload:{...routine,id:crypto.randomUUID(),name:'Disabled import check',enabled:false,schedule:{cron:'0 4 * * *',timezone:'Asia/Singapore'}}};
 const commands=[draft];const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(commands)));const reviewed_hash=Buffer.from(bytes).toString('hex');
 const adopted=await send('setup.adopt',{commands,reviewed_hash,monitoring_timezone:'Asia/Singapore'});assert.equal(adopted.value.status,'applied');checks++;
 const badImport=await send('setup.adopt',{commands,reviewed_hash:'0'.repeat(64),monitoring_timezone:'Asia/Singapore'});assert.equal(badImport.value.error.code,'REVISION_CONFLICT');checks++;
 const module=await fetch(base+'/import-setup.js');assert.equal(module.status,200);assert.match(await module.text(),/setup.adopt/);checks++;
 const csrf=await send('message.send',payload,crypto.randomUUID(),'https://wrong.example');assert.equal(csrf.status,403);checks++;
 const bad=await send('message.send',{conversation_id:bot,text:''});assert.equal(bad.status,422);checks++;
 const runtime=await fetch(base+'/internal/boot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({boot_id:crypto.randomUUID()})});assert.ok([401,503].includes(runtime.status));checks++;
 for(let i=0;i<24;i++){const result=await send('persona.put',{id:crypto.randomUUID(),expected_revision:0,name:`Export fixture ${i}`,instructions:'Synthetic export data: '+String(i)+':'+ 'x'.repeat(15500),tool_policy_ids:[],archived:true});assert.equal(result.value.status,'applied');}
 const exported=await fetch(base+'/v1/export/control');assert.equal(exported.status,200,'Bounded application export must succeed');assert.match(exported.headers.get('Content-Disposition'),/attachment/);assert.match(exported.headers.get('Cache-Control'),/no-store/);
 const text=await exported.text();assert.ok(Buffer.byteLength(text)>1024*1024&&Buffer.byteLength(text)<=4*1024*1024,'Exercise streamed RPC above the plain-value size limit');
 const data=JSON.parse(text);assert.equal(data.format,'hehebot-control-export');assert.equal(data.schemaSha256,'1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb');assert.ok(data.tables.find(table=>table.name==='runs').rows.some(row=>row[0].value===sent.value.resource_id));assert.ok(data.tables.some(table=>table.name==='flight_restore_deadlines'));assert.equal(data.tables.some(table=>table.name.startsWith('_cf_')||table.name.startsWith('__miniflare')),false);checks++;
 const exportFile=join(directory,'control-export.json'),snapshot=join(directory,'reconstructed');
 await writeFile(exportFile,text,{mode:0o600});
 assert.equal((await importControlExport(exportFile,snapshot)).activation_allowed,false);
 assert.equal((await verifyControl(snapshot)).createdAt,data.createdAt);
 const reconstructed=new DatabaseSync(join(snapshot,'control.sqlite'),{readOnly:true});
 try{
  for(const table of data.tables){
   const query=reconstructed.prepare(`SELECT * FROM "${table.name}"`);query.setReadBigInts(true);
   const actual=query.all().map(row=>JSON.stringify(table.columns.map(column=>{const value=row[column];return {type:value===null?'null':typeof value==='bigint'?'integer':'text',value:typeof value==='bigint'?String(value):value};}))).sort();
   assert.deepEqual(actual,table.rows.map(row=>JSON.stringify(row)).sort(),`Exact reconstruction of ${table.name}`);
  }
  assert.equal(reconstructed.prepare('SELECT status FROM runs WHERE id=?').get(sent.value.resource_id).status,'waiting');
  assert.equal(reconstructed.prepare('SELECT revision FROM objects WHERE id=?').get(routine.id).revision,1);
 }finally{reconstructed.close();}
 checks++;
 console.log(`PASS: ${checks} real local Worker/SQLite HTTP checks; assets, receipts, dedupe/conflict, memory, schedules, no-op, CSRF, runtime gate and >1MiB export/exact offline reconstruction. No model/provider calls.`);
}catch(error){console.error(logs.slice(-5000));throw error;}
finally{
 clearTimeout(timeout);child.kill('SIGTERM');
 await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,5000))]);
 await rm(directory,{recursive:true,force:true});
}
