#!/usr/bin/env node
// Synthetic browser contract only; no native termination or effect settlement proof.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID(),session=`cancel-${randomUUID().slice(0,8)}`;
const a={id:randomUUID(),persona_id:bot,title:'Task A — review arrival form',role:'background',status:'running',current_attempt:3};
const b={id:randomUUID(),persona_id:bot,title:'Task B — check rail timetable',role:'background',status:'waiting',current_attempt:8};
const identities=[{id:bot,kind:'persona',revision:2,body:{name:'Travel'}},{id:other,kind:'persona',revision:5,body:{name:'Finance'}}];
const state={objects:identities,runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:1}};
let rows=[],source='snapshot',offline=false,failTasks=false,reply='applied',refreshNumber=0;
const commands=[],browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const refresh=async()=>{
 state.provider={id:`Synthetic observation ${++refreshNumber}`};
 await browser('eval','document.querySelector("#refresh").onclick()');
 await wait(`(()=>{if(document.querySelector('#connection').textContent===${JSON.stringify(offline||failTasks&&source==='page'?'Offline':'Connected')}&&${offline||failTasks&&source==='page'?'true':`document.querySelector('#runtime-provider').textContent===${JSON.stringify(state.provider.id)}`})return true;document.querySelector('#refresh').onclick();return false;})()`);
};
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const url=new URL(req.url,'http://fixture'),path=url.pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Oversized command');}
   commands.push({raw,command:JSON.parse(raw),key:req.headers['idempotency-key'],contentType:req.headers['content-type']});
   if(reply==='disconnect'){res.writeHead(200,{'content-type':'application/json'});res.write('{"status":');setTimeout(()=>res.destroy(),20);return;}
   if(reply==='malformed'){res.writeHead(200,{'content-type':'application/json'});res.end('lost reply');return;}
   if(reply==='unknown')return json({status:'unexpected'});
   if(reply==='server')return json({error:{message:'Synthetic server uncertainty'}},503);
   if(reply==='rejected')return json({status:'rejected',error:{message:'Synthetic rejection'}});
   if(reply==='http')return json({error:{message:'Synthetic permission denied'}},403);
   return json({status:reply});
  }
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(path.endsWith('/tasks')||path.endsWith('/recovery')){
   if(failTasks)return json({error:{message:'Synthetic task page outage'}},503);
   const page=path.includes(other)?[]:url.searchParams.has('after')?[b]:rows;
   return json({counts:{total:page.length,waiting:1,recovery:0},runs:page,next_cursor:url.searchParams.has('after')?null:'next'});
  }
  if(path.endsWith('/events'))return json({events:path.includes(other)?[]:[a,b].map((run,index)=>({id:randomUUID(),sequence:index+1,conversation_id:bot,type:'run.accepted',created_at:'2026-09-16T01:00:00Z',payload:{run_id:run.id}})),has_more:false});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const clickText=label=>browser('eval',`[...document.querySelectorAll('#timeline button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
const open=async(entry=source==='page'?'card':'timeline',run=a)=>{
 if(entry==='timeline')await browser('eval',`[...document.querySelectorAll('#timeline .event')][${run.id===a.id?0:1}].querySelector('button').click()`);
 else{await browser('eval',`document.querySelector('[data-run-id="${run.id}"]').open=true`);await browser('click',`[data-run-id="${run.id}"] .danger`);}
 await wait('document.querySelector("#editor").open');
};
const consent=()=>browser('check','#editor [name=confirm]');
const submit=()=>browser('click','#editor-form button[type=submit]');
const close=()=>browser('press','Escape');
const blocked=async(pattern=/changed|stale|offline/)=>{
 const count=commands.length;await submit();await wait('!document.querySelector("#editor-error").hidden');
 assert.equal(commands.length,count);assert.match((await browser('get','text','#editor-error')).stdout,pattern);
 assert.equal(await evaluate('document.querySelector("#editor-error").getAttribute("role")'),'alert');
};
const reset=async kind=>{
 source=kind;offline=false;failTasks=false;reply='applied';rows=structuredClone([a,b]);state.runs=kind==='snapshot'?rows:[];
 state.objects=structuredClone(identities);await browser('eval','delete navigator.onLine');await refresh();
 await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);await refresh();
 if(kind==='page'){
  await browser('eval','document.querySelector("#task-strip").open=true');
  await browser('click',`[data-task-id="${a.id}"]`);await wait(`document.querySelector('[data-run-id="${a.id}"]')?.open===true`);
 }
};
const capture=async name=>{
 assert.equal(await evaluate('devicePixelRatio'),2);
 await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await browser('screenshot',decodeURIComponent(new URL(name,artifacts).pathname));
};
const envelope=(row,run,reason)=>{
 assert.deepEqual(row.command,{schema_version:1,type:'run.cancel',payload:{run_id:run.id,reason}});
 assert.match(row.key,/^[0-9a-f-]{36}$/);assert.equal(row.contentType,'application/json');
};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await reset('snapshot');
 await open();await submit();assert.equal(commands.length,0);
 await browser('focus','#editor-form button[type=submit]');await browser('press','Enter');assert.equal(commands.length,0);
 assert.equal(await evaluate('document.querySelector("#editor").getAttribute("aria-labelledby")'),'editor-title');
 const copy=(await browser('get','text','#editor')).stdout;
 for(const text of [a.title,a.id,'attempt 3','Working','not confirmed executor termination','does not undo or roll back effects','server has no attempt precondition','Reconnecting never retries'])assert.ok(copy.includes(text),text);
 assert.ok(!copy.includes(b.id));assert.ok(!copy.includes(b.title));
 await close();await open();
 await capture('portal-task-cancel-desktop.png');await close();assert.equal(commands.length,0);
 await open();await consent();await browser('focus','#editor-form button[type=submit]');await browser('press','Enter');await wait('!document.querySelector("#editor").open');
 envelope(commands.at(-1),a,'Owner requested cancellation.');assert.equal(rows[1].status,'waiting');
 await open('card',b);await consent();await submit();await wait('!document.querySelector("#editor").open');
 envelope(commands.at(-1),b,'Owner selected this task for cancellation.');assert.notEqual(commands[0].key,commands[1].key);
 await reset('page');assert.equal(state.runs.length,0);await open();await consent();reply='accepted';await submit();await wait('!document.querySelector("#editor").open');
 envelope(commands.at(-1),a,'Owner selected this task for cancellation.');assert.equal(commands.length,3);
 console.log('PASS both entry points, snapshot and independent paged source, exact A/B envelopes, fresh keys, Escape/Enter/required confirmation, runtime gate false unchanged.');
 for(const kind of ['snapshot','page'])for(const change of ['attempt','status','completed','cancelled','failed','cancelling','recovery_required','missing','title','owner','role','identity','offline','browser-offline','navigation','roundtrip','view-roundtrip',...(kind==='page'?['page','page-offline']:[])]){
  await reset(kind);await open();await consent();
  if(change==='attempt')rows[0].current_attempt++;
  if(change==='status')rows[0].status='waiting';
  if(['completed','cancelled','failed','cancelling','recovery_required'].includes(change))rows[0].status=change;
  if(change==='missing')rows.splice(0,1);
  if(change==='title')rows[0].title='Replacement title';
  if(change==='owner')rows[0].persona_id=other;
  if(change==='role')rows[0].role='coordinator';
  if(change==='identity')state.objects[0].revision++;
  if(change==='offline')offline=true;
  if(change==='page-offline')failTasks=true;
  if(change==='browser-offline')await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,value:false})');
  if(['navigation','roundtrip'].includes(change)){
   await browser('eval',`document.querySelector('[data-persona-id="${other}"]').click()`);
   if(change==='roundtrip')await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);
  }
  if(change==='view-roundtrip'){
   if(kind==='page')await clickText('Back to messages');
   await clickText('Review recovery tasks');await wait('document.querySelector("#timeline").textContent.includes("Back to messages")');await clickText('Back to messages');
  }
  if(change==='page')await clickText('Next task page');
  await refresh();await blocked();
  if(kind==='snapshot'&&change==='offline'){
   await browser('set','viewport','390','844','2');
   assert.deepEqual(await evaluate(`(()=>{const fields=document.querySelector('#editor-fields'),action=document.querySelector('#editor-form button[type=submit]').getBoundingClientRect();fields.scrollTop=fields.scrollHeight;return {scrolls:fields.scrollTop>0,overflow:getComputedStyle(fields).overflowY,actionFits:action.bottom<=innerHeight&&action.top>=0};})()`),{scrolls:true,overflow:'auto',actionFits:true});
   await capture('portal-task-cancel-narrow-offline.png');await browser('set','viewport','1280','900','2');
  }
  await close();console.log(`PASS ${kind} ${change}: no command.`);
 }
 for(const mode of ['malformed','disconnect','server','unknown']){
  const before=commands.length;
  await reset('snapshot');reply=mode;await open();await consent();await submit();await wait('!document.querySelector("#editor-error").hidden');
  assert.equal(commands.length,before+1,`${mode}: one request before explicit retry`);
  const first=commands.at(-1),count=commands.length;
  assert.match((await browser('get','text','#editor-error')).stdout,/outcome unknown/);
  assert.equal((await browser('get','text','#editor-form button[type=submit]')).stdout.trim(),'Retry same cancellation');
  if(mode==='malformed'){
   await capture('portal-task-cancel-uncertain.png');offline=true;await refresh();await blocked();offline=false;
   rows[0].current_attempt++;await refresh();await blocked();rows[0].current_attempt--;
  }
  await refresh();assert.equal(commands.length,count,'refresh/reconnect must not replay');
  await browser('uncheck','#editor [name=confirm]');await submit();assert.equal(commands.length,count);await consent();
  reply='applied';await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands.at(-1),first,'explicit retry preserves bytes and key');
  assert.equal(commands.length,before+2,`${mode}: one explicit retry`);
  console.log(`PASS ${mode}: uncertainty alert and exact-payload same-key explicit retry only.`);
 }
 for(const mode of ['rejected','http']){
  await reset('snapshot');reply=mode;await open();await consent();await submit();await wait('!document.querySelector("#editor-error").hidden');
  assert.match((await browser('get','text','#editor-error')).stdout,/Synthetic/);
  assert.equal((await browser('get','text','#editor-form button[type=submit]')).stdout.trim(),'Request cancellation');
  await blocked(/rejected/);await close();console.log(`PASS ${mode}: rejection is visible and cannot be retried in the editor.`);
 }
 await reset('snapshot');
 for(const status of ['queued','claimed','running','finishing','waiting','completed','failed','cancelled','cancelling','recovery_required']){
  rows[0].status=status;await refresh();
  assert.equal(await evaluate(`[...document.querySelectorAll('#timeline .event')][0].textContent.includes('Cancel')&&!![...document.querySelectorAll('#timeline .event')][0].querySelector('button')`),['queued','claimed','running','waiting'].includes(status));
  assert.equal(await evaluate(`!!document.querySelector('[data-run-id="${a.id}"] .danger')`),['queued','claimed','running','finishing','waiting'].includes(status));
 }
 assert.equal(commands.length,13);console.log('PASS eligibility matrix preserved; 13 synthetic command envelopes; no runtime, accounts, native termination or external effects exercised.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
