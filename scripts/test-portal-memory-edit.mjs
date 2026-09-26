#!/usr/bin/env node
// Chromium UI contracts with synthetic HTTP only; no accounts or real memory writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID(),source=randomUUID(),foreign=randomUUID();
const memory={id:randomUUID(),kind:'memory',revision:7,body:{text:'Synthetic private preference',scope:{kind:'persona',id:bot},source_event_id:source,expires_at:'2091-03-17T04:23:11.000Z',sensitivity:'sensitive'}};
const state={objects:[{id:bot,kind:'persona',revision:3,body:{name:'Travel'}},{id:other,kind:'persona',revision:5,body:{name:'Finance'}},memory],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let offline=false,reply='applied',foreignOnly=false;
const commands=[],receipts=new Map(),session=`memory-${randomUUID().slice(0,8)}`;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
// A rendered marker avoids mistaking a skipped refresh (loading=true) for fresh state.
let refreshNumber=0;
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
   const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key});
   assert.equal(command.type,'memory.put');assert.ok(key);
   if(reply==='rejected')return json({status:'rejected',error:{message:'Synthetic revision conflict'}});
   if(reply==='http')return json({error:{message:'Synthetic permission denied'}},403);
   if(!receipts.has(key))receipts.set(key,{id:randomUUID(),status:'applied'});
   if(reply==='uncertain'){res.writeHead(200,{'content-type':'application/json'});res.end('lost reply');return;}
   return json(receipts.get(key));
  }
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[...(!foreignOnly?[{id:source,sequence:1,conversation_id:bot,type:'message.user',payload:{text:'Synthetic source'}}]:[]),{id:foreign,sequence:2,conversation_id:other,type:'message.user',payload:{text:'Foreign source'}}],has_more:false,pruned_through:foreignOnly?1:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async()=>{await browser('click','#memories .card button');await wait('document.querySelector("#editor").open');};
const submit=()=>browser('click','#editor-form button[type="submit"]');
const close=()=>browser('press','Escape');
const reject=async(message=/stale|changed|offline/)=>{const count=commands.length;await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,count);assert.match((await browser('get','text','#editor-error')).stdout,message);assert.equal(await evaluate('document.querySelector("#editor-error").getAttribute("role")'),'alert');};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await refresh();
 await open();await browser('fill','#editor [name="text"]','Changed text, retained metadata');
 await browser('focus','#editor-form button[type="submit"]');await browser('press','Enter');await wait('!document.querySelector("#editor").open');
 assert.deepEqual(commands[0].command.payload,{id:memory.id,expected_revision:7,...memory.body,text:'Changed text, retained metadata'},'text-only edit must preserve sensitive expiring metadata and original provenance');
 console.log('PASS text-only edit: exact sensitive expiry/source/persona/revision preserved (keyboard Enter).');
 await open();assert.equal(await evaluate('document.querySelector("#editor").getAttribute("aria-labelledby")'),'editor-title');
 assert.match((await browser('get','text','#editor')).stdout,/sensitive.*2091-03-17T04:23:11.000Z/s);
 await browser('screenshot',decodeURIComponent(new URL('portal-memory-preserved.png',artifacts).pathname));
 await browser('select','#editor [name="scope"]','global');await submit();await wait('!document.querySelector("#editor").open');
 assert.deepEqual(commands.at(-1).command.payload.scope,{kind:'global',id:null});assert.equal(commands.at(-1).command.payload.sensitivity,'sensitive');
 memory.body.scope={kind:'global',id:null};await refresh();await open();await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands.at(-1).command.payload.scope,{kind:'global',id:null});
 await open();await browser('select','#editor [name="scope"]','persona');await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands.at(-1).command.payload.scope,{kind:'persona',id:bot});
 for(const change of ['revision','deleted','scope','persona','offline','navigation','roundtrip']){
  await open();
  if(change==='revision')memory.revision=8;
  if(change==='deleted')state.objects=state.objects.filter(row=>row!==memory);
  if(change==='scope')memory.body.scope={kind:'persona',id:other};
  if(change==='persona')state.objects[0].revision++;
  if(change==='offline')offline=true;
  if(['navigation','roundtrip'].includes(change)){
   await browser('eval',`document.querySelector('[data-persona-id="${other}"]').click()`);
   if(change==='roundtrip')await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);
  }
  await refresh();await reject();
  if(change==='offline'){
   await browser('set','viewport','390','844','2');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
   await browser('screenshot',decodeURIComponent(new URL('portal-memory-offline.png',artifacts).pathname));await browser('set','viewport','1280','900','2');
  }
  await close();memory.revision=7;memory.body.scope={kind:'global',id:null};if(!state.objects.includes(memory))state.objects.push(memory);offline=false;
  await browser('eval',`document.querySelector('[data-persona-id="${bot}"]').click()`);await refresh();
  console.log(`PASS ${change} fence: no command.`);
 }
 for(const mode of ['uncertain','rejected','http']){
  reply=mode;await open();await browser('fill','#editor [name="text"]',`Attempt ${mode}`);await submit();await wait('!document.querySelector("#editor-error").hidden');
  const first=commands.at(-1),count=commands.length;
  assert.equal(await evaluate('document.querySelector("#editor [name=text]").readOnly'),true);
  assert.equal(await evaluate('document.querySelector("#editor [name=scope]").disabled'),true);
  if(mode==='uncertain')await browser('screenshot',decodeURIComponent(new URL('portal-memory-uncertain.png',artifacts).pathname));
  if(mode==='rejected')assert.match((await browser('get','text','#editor-error')).stdout,/revision conflict/);
  if(mode==='http')assert.match((await browser('get','text','#editor-error')).stdout,/permission denied/);
  if(mode==='uncertain'){memory.revision=8;await refresh();await reject();memory.revision=7;}
  await refresh();assert.equal(commands.length,count,'refresh must never replay');
  // Even programmatic form changes cannot alter an uncertain retry's payload.
  await browser('eval','document.querySelector("#editor [name=text]").value="Not the submitted text"');
  if(mode==='uncertain')reply='applied';
  await submit();await wait('!document.querySelector("#editor-form button[type=submit]").disabled');assert.equal(commands.length,count+1);assert.deepEqual(commands.at(-1),first);
  if(mode==='uncertain')await wait('!document.querySelector("#editor").open');
  else{await wait('!document.querySelector("#editor-error").hidden');assert.equal(await evaluate('document.querySelector("#editor").open'),true);await close();}
  console.log(`PASS ${mode}: visible error, no automatic replay, identical explicit retry.`);
 }
 reply='applied';
 // Browser connectivity is checked even before the next failed state refresh.
 await open();await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,value:false})');await reject();await close();await browser('eval','delete navigator.onLine');
 // Existing provenance is never replaced with an unrelated recent message.
 const savedSource=memory.body.source_event_id;memory.body.source_event_id=null;await refresh();await browser('click','#memories .card button');assert.equal(await evaluate('document.querySelector("#editor").open'),false);memory.body.source_event_id=savedSource;await refresh();
 await browser('click','#add-memory');await browser('fill','#editor [name=text]','New preference');reply='uncertain';await submit();await wait('!document.querySelector("#editor-error").hidden');
 const first=commands.at(-1);assert.equal(first.command.payload.source_event_id,source);assert.equal(first.command.payload.expires_at,null);assert.equal(first.command.payload.sensitivity,'ordinary');assert.deepEqual(first.command.payload.scope,{kind:'global',id:null});
 reply='applied';await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands.at(-1),first,'new memory id and key must survive uncertain retry');
 foreignOnly=true;await refresh();await browser('click','#add-memory');assert.equal(await evaluate('document.querySelector("#editor").open'),false);assert.match((await browser('get','text','#error')).stdout,/Send a message/);
 console.log('PASS new memory: selected-conversation source only; stable ID/key on retry; no foreign-source fallback.');
 assert.equal(commands.length,12);
 console.log(`PASS portal memory editor: ${commands.length} synthetic commands; no live accounts, runtime or provider calls.`);
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
