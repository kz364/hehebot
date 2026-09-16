#!/usr/bin/env node
// Chromium + synthetic receipts, no accounts, native runtime or real deletion.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`delete-${randomUUID().slice(0,8)}`,bot=randomUUID(),other=randomUUID();
const routine={id:randomUUID(),kind:'routine',revision:7,body:{persona_id:bot,name:'Weekly travel review',instructions:'Synthetic read-only review',enabled:true,schedule:{cron:'0 8 * * 1',timezone:'Asia/Jakarta'}}};
const sibling={...routine,id:randomUUID(),revision:2,body:{...routine.body,persona_id:other,name:'Other bot routine'}};
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}},{id:other,kind:'persona',body:{name:'Finance'}},routine,sibling],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let offline=false,loseResponse=true;
const commands=[],receipts=new Map();
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('Oversized fixture command');}
   const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key});
   assert.deepEqual(command,{schema_version:1,type:'routine.delete',payload:{id:routine.id,expected_revision:7}});
   assert.equal(typeof key,'string');
   if(!receipts.has(key))receipts.set(key,{id:randomUUID(),status:'applied'});
   if(loseResponse){loseResponse=false;return json({error:{message:'Synthetic response lost. Outcome is not confirmed.'}},503);}
   state.objects=state.objects.filter(row=>row.id!==routine.id);return json(receipts.get(key));
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline state'}},503):json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async()=>{await click('[data-action="delete-routine"]');await wait('document.querySelector("#editor").open');};
const confirm=()=>browser('check','#editor [name="confirm"]');
const submit=()=>click('#editor-form button[type="submit"]');
const reject=async()=>{await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,0);assert.match((await browser('get','text','#editor-error')).stdout,/stale or changed/);};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');
 await wait('document.querySelector("#connection").textContent==="Connected"');
 await browser('eval','window.confirm=()=>{throw Error("Native confirmation must not be used")};');
 await open();assert.match((await browser('get','text','#editor')).stdout,new RegExp(`${routine.id}.*revision 7`));
 assert.equal(await evaluate('document.querySelector("#editor").getAttribute("aria-labelledby")'),'editor-title');
 await submit();assert.equal(commands.length,0);assert.equal(await evaluate('document.querySelector("#editor-form").checkValidity()'),false);
 await browser('screenshot',new URL('routine-delete-confirmation.png',artifacts).pathname);
 await browser('press','Escape');assert.equal(await evaluate('document.querySelector("#editor").open'),false);
 await open();await confirm();routine.revision=8;await refresh();await reject();routine.revision=7;
 await browser('press','Escape');await refresh();await open();await confirm();
 offline=true;await refresh();await reject();
 assert.equal(await evaluate('document.querySelector("[data-action=delete-routine]").disabled'),true);
 await browser('set','viewport','390','844','2');await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 assert.equal(await evaluate('document.querySelector("#editor-error").getAttribute("role")'),'alert');
 await browser('screenshot',new URL('routine-delete-offline-narrow.png',artifacts).pathname);
 offline=false;await refresh();assert.equal(commands.length,0);await browser('press','Escape');
 await browser('set','viewport','1280','900','2');await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 await open();await confirm();routine.body.persona_id=other;await refresh();await reject();routine.body.persona_id=bot;
 await browser('press','Escape');await refresh();await open();await confirm();
 // A selection change can occur behind the modal through another app event.
 await browser('eval',`document.querySelector('[data-persona-id="${other}"]').click()`);await refresh();await reject();
 await browser('press','Escape');await click(`[data-persona-id="${bot}"]`);await refresh();
 await browser('set','viewport','1280','900','2');await open();await confirm();
 await browser('focus','#editor-form button[type="submit"]');await browser('press','Enter');
 await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,1);
 await browser('screenshot',new URL('routine-delete-uncertain.png',artifacts).pathname);
 await submit();await wait('!document.querySelector("#editor").open');
 assert.equal(commands.length,2);assert.equal(commands[0].key,commands[1].key);assert.equal(receipts.size,1);
 assert.equal(state.objects.some(row=>row.id===sibling.id),true);
 await click('#add-routine');assert.equal((await browser('get','text','#editor-form button[type="submit"]')).stdout.trim(),'Save');
 console.log('PASS: no window.confirm, explicit confirmation/Escape/Enter, revision/owner/selection/offline fencing, no reconnect replay, same-key uncertain retry, sibling preservation and Save-label reset. Two synthetic requests, one receipt.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
