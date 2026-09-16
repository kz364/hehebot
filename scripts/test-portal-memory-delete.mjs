#!/usr/bin/env node
// Synthetic Chromium contract, not proof of backend purge or native cancellation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID();
const memory={id:randomUUID(),kind:'memory',revision:7,body:{text:'Synthetic travel preference: quiet room, late arrival.',scope:{kind:'persona',id:bot}}};
const sibling={id:randomUUID(),kind:'memory',revision:19,body:{text:'Synthetic sibling: use train travel.',scope:{kind:'global',id:null}}};
const foreign={id:randomUUID(),kind:'memory',revision:23,body:{text:'Foreign finance memory',scope:{kind:'persona',id:other}}};
const identities=[{id:bot,kind:'persona',revision:3,body:{name:'Travel'}},{id:other,kind:'persona',revision:5,body:{name:'Finance'}}];
const state={objects:[...identities,memory,sibling,foreign],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let offline=false,reply='applied',refreshNumber=0;
const commands=[],session=`forget-${randomUUID().slice(0,8)}`;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const refresh=async()=>{
 state.provider={id:`Synthetic refresh ${++refreshNumber}`};
 await browser('eval','document.querySelector("#refresh").onclick()');
 await wait(`(()=>{if(document.querySelector('#connection').textContent===${JSON.stringify(offline?'Offline':'Connected')}&&${offline?'true':`document.querySelector('#runtime-provider').textContent===${JSON.stringify(state.provider.id)}`})return true;document.querySelector('#refresh').onclick();return false;})()`);
};
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Oversized command');}
   commands.push({command:JSON.parse(raw),key:req.headers['idempotency-key']});
   if(reply==='uncertain'){res.writeHead(200,{'content-type':'application/json'});res.end('lost reply');return;}
   if(reply==='rejected')return json({status:'rejected',error:{message:'Synthetic revision conflict'}});
   if(reply==='http')return json({error:{message:'Synthetic permission denied'}},403);
   return json({status:'applied'});
  }
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async(index=0)=>{await browser('click',`#memories .card:nth-child(${index+1}) [data-action="delete-memory"]`);await wait('document.querySelector("#editor").open');};
const submit=()=>browser('click','#editor-form button[type="submit"]');
const consent=()=>browser('check','#editor [name=confirm]');
const close=()=>browser('press','Escape');
const reject=async()=>{const count=commands.length;await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,count);assert.match((await browser('get','text','#editor-error')).stdout,/stale|changed|offline/);};
const capture=async name=>{assert.equal(await evaluate('devicePixelRatio'),2);await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await browser('screenshot',new URL(name,artifacts).pathname);};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await refresh();
 assert.equal(await evaluate('document.querySelectorAll("#memories .card").length'),2);
 await open();assert.equal(commands.length,0);await submit();assert.equal(commands.length,0);
 await browser('focus','#editor-form button[type=submit]');await browser('press','Enter');assert.equal(commands.length,0);
 assert.equal(await evaluate('document.querySelector("#editor").getAttribute("aria-labelledby")'),'editor-title');
 const copy=(await browser('get','text','#editor')).stdout;
 for(const text of [memory.body.text,memory.id,'revision 7','current and prior canonical','Queued contexts','cancellation is requested','not confirmed','backups and third-party copies are not proven removed'])assert.ok(copy.includes(text),text);
 assert.ok(copy.includes('Past conversations and completed task copies may remain.'));
 assert.ok(!copy.includes(sibling.body.text));await capture('portal-forget-desktop.png');await close();assert.equal(commands.length,0);
 await open();await consent();await browser('focus','#editor-form button[type=submit]');await browser('press','Enter');await wait('!document.querySelector("#editor").open');
 assert.deepEqual(commands[0].command,{schema_version:1,type:'memory.delete',payload:{id:memory.id,expected_revision:7,purge_transcripts:false}});assert.ok(commands[0].key);
 await open(1);await consent();await submit();await wait('!document.querySelector("#editor").open');
 assert.deepEqual(commands[1].command.payload,{id:sibling.id,expected_revision:19,purge_transcripts:false});assert.notEqual(commands[1].key,commands[0].key);
 console.log('PASS consent, Escape, Enter, exact asymmetric persona/global envelopes and foreign exclusion.');
 for(const change of ['revision','deleted','tombstone','scope','identity','archived','offline','browser-offline','navigation','roundtrip']){
  await open();await consent();
  if(change==='revision')memory.revision++;
  if(change==='deleted')state.objects=state.objects.filter(row=>row!==memory);
  if(change==='tombstone')memory.deleted_at='2026-09-16T00:00:00Z';
  if(change==='scope')memory.body.scope={kind:'global',id:null};
  if(change==='identity')identities[0].revision++;
  if(change==='archived')identities[0].body.archived=true;
  if(change==='offline')offline=true;
  if(change==='browser-offline')await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,value:false})');
  if(['navigation','roundtrip'].includes(change)){
   await browser('eval',`document.querySelector('[data-persona-id="${other}"]').click()`);
   if(change==='roundtrip')await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);
  }
  await refresh();await reject();
  if(change==='offline'){
   await browser('set','viewport','390','844','2');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
   assert.deepEqual(await evaluate(`(()=>{const fields=document.querySelector('#editor-fields'),error=document.querySelector('#editor-error'),action=document.querySelector('#editor-form button[type=submit]').getBoundingClientRect();fields.scrollTop=fields.scrollHeight;return {scrolls:fields.scrollTop>0,overflow:getComputedStyle(fields).overflowY,errorFits:error.scrollHeight<=error.clientHeight,actionFits:action.bottom<=innerHeight&&action.top>=0};})()`),{scrolls:true,overflow:'auto',errorFits:true,actionFits:true},'narrow fields scroll independently while error and action remain visible');
   await capture('portal-forget-narrow-offline.png');await browser('set','viewport','1280','900','2');
  }
  await close();memory.revision=7;delete memory.deleted_at;memory.body.scope={kind:'persona',id:bot};identities[0].body.archived=false;offline=false;await browser('eval','delete navigator.onLine');state.objects=[...identities,memory,sibling,foreign];
  await refresh();await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);await refresh();
  console.log(`PASS ${change}: no command.`);
 }
 for(const mode of ['uncertain','rejected','http']){
  reply=mode;await open();await consent();await submit();await wait('!document.querySelector("#editor-error").hidden');
  const first=commands.at(-1),count=commands.length;
  assert.equal(await evaluate('document.querySelector("#editor-error").getAttribute("role")'),'alert');
  assert.match((await browser('get','text','#editor-form button[type=submit]')).stdout,/Retry same deletion/);
  if(mode==='uncertain'){
   await capture('portal-forget-uncertain.png');offline=true;await refresh();await reject();offline=false;
   memory.revision++;await refresh();await reject();memory.revision=7;
  }
  await refresh();assert.equal(commands.length,count,'reconnect and refresh cannot replay');
  await browser('uncheck','#editor [name=confirm]');await submit();assert.equal(commands.length,count);await consent();reply='applied';await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands.at(-1),first);
  console.log(`PASS ${mode}: visible error, explicit same-key exact-payload retry only.`);
 }
 assert.equal(commands.length,8);assert.ok(commands.every(row=>row.command.payload.id!==foreign.id));
 console.log('PASS portal memory deletion: 8 synthetic commands; no live purge, accounts, runtime or provider calls.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
