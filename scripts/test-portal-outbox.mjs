#!/usr/bin/env node
// Synthetic browser fixtures only; no model, account, provider or gateway calls.
// Covers GROK_ALIGNMENT A5 (durable client outbox) acceptance G-A5, and the
// A7 clean-thread split between bot.message bubbles and ephemeral provisional
// text (G-A7), against a synthetic HTTP fixture — no real /v1/stream server.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

const bot=randomUUID(),session='outbox-'+randomUUID().slice(0,8);
const run=randomUUID();
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Assistant'}}],
 runs:[{id:run,persona_id:bot,role:'coordinator',status:'running',current_attempt:1,title:'Live task'}],
 output_previews:[{run_id:run,attempt:1,text:'Synthetic provisional working text',version:1}],
 summary:{phase:'READY',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let events=[];
// commandMode selects how POST /v1/commands behaves for the next send:
//  'network-fail' -> destroy the socket (simulates a dead network: fetch rejects)
//  'reject'       -> 422 {status:'rejected'} (a refused command)
//  'ok'           -> 202 {status:'applied'} and the message.user event commits
let commandMode='ok';
const applied=new Map(); // idempotency key -> {id,status}
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);

const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 const url=new URL(req.url,'http://fixture'),path=url.pathname;
 if(path==='/v1/commands'){
  const key=req.headers['idempotency-key'];
  if(commandMode==='network-fail'){req.socket.destroy();return;}
  if(commandMode==='reject'){applied.set(key,{status:'rejected'});return json({status:'rejected',error:{code:'INVALID_INPUT',message:'Synthetic rejection'}},422);}
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);
  const id=randomUUID();applied.set(key,{status:'applied',id});
  events.push({sequence:events.length+1,id,conversation_id:bot,type:'message.user',created_at:new Date().toISOString(),payload:{text:body.payload.text,idempotency_key:key}});
  return json({id,status:'applied',accepted_at:new Date().toISOString(),resource_id:null,error:null},202);
 }
 if(path==='/v1/receipts'){
  const key=url.searchParams.get('idempotency_key'),record=applied.get(key);
  if(!record)return json({error:{code:'NOT_FOUND',message:'Receipt unavailable.'}},404);
  return json({id:record.id??randomUUID(),status:record.status,accepted_at:new Date().toISOString(),resource_id:null,error:record.status==='rejected'?{code:'INVALID_INPUT',message:'Synthetic rejection',retryable:false}:null},200);
 }
 if(path==='/v1/state')return json(state);
 if(path.endsWith('/tasks'))return json({counts:{total:1,waiting:0,recovery:0},runs:state.runs,next_cursor:null});
 if(path.endsWith('/recovery'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],recovery:[],next_cursor:null});
 if(path.startsWith('/v1/conversations/'))return json({events:path.includes(bot)?events:[],has_more:false,pruned_through:0});
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
 if(!file){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL('../public/'+file,import.meta.url)));
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async()=>{await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');};
const bubbleTexts=()=>evaluate('Array.from(document.querySelectorAll("article.message.user .message-body"),e=>e.textContent)');

try{
 await open();

 // --- bot.message renders as a bubble; provisional text never does (A7/G-A7) ---
 events.push({sequence:1,id:randomUUID(),conversation_id:bot,type:'bot.message',created_at:new Date().toISOString(),
  payload:{text:'Synthetic completed reply',run_id:run,attempt:1,task_run_id:run,origin:'final_text',reply_to_event_id:null}});
 await browser('click','#refresh');
 await wait('document.querySelectorAll("article.message.bot .message-body").length===1');
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("article.message.bot .message-body"),e=>e.textContent)'),['Synthetic completed reply']);
 assert.match(await evaluate('document.querySelector("article.message.bot .message-head").textContent'),/task:/);
 await evaluate('document.querySelector(".task-card").open=true');
 assert.equal(await evaluate('document.querySelectorAll(".message .provisional-text").length'),0,'provisional text is never inside a chat bubble');
 assert.equal(await evaluate('document.querySelectorAll(".provisional-typing .provisional-text").length'),1,'provisional text renders once, outside any bubble');
 assert.equal(await evaluate('document.querySelector(".provisional-typing").textContent').then(t=>t.includes('Synthetic provisional working text')),true);
 await browser('screenshot',decodeURIComponent(new URL('portal-outbox-bot-message.png',artifacts).pathname));

 // --- rejected send restores the draft (A5/G-A5) ---
 commandMode='reject';
 await browser('fill','#message','Draft that will be rejected');
 await browser('click','#send');
 await wait('document.querySelector("#error").textContent.length>0');
 await wait('document.querySelector("#message").value==="Draft that will be rejected"');
 assert.equal(await evaluate('document.querySelectorAll("article.message.user.outbox-pending").length'),0,'a rejected send leaves no outbox bubble behind');
 await browser('screenshot',decodeURIComponent(new URL('portal-outbox-rejected.png',artifacts).pathname));

 // --- network-killed send reconciles to exactly one message after reload (A5/G-A5) ---
 commandMode='network-fail';
 await browser('fill','#message','Message sent while the network is down');
 await browser('click','#send');
 await wait('document.querySelector(".outbox-status")?.textContent.includes("Not delivered")');
 assert.deepEqual(await bubbleTexts(),['Message sent while the network is down']);

 // The network recovers before the reload's reconciliation resend lands.
 commandMode='ok';
 await browser('reload');
 await wait('document.querySelector("#connection").textContent==="Connected"');
 await wait('document.querySelectorAll("article.message.user .message-body").length===1');
 assert.deepEqual(await bubbleTexts(),['Message sent while the network is down']);
 assert.equal(await evaluate('document.querySelectorAll(".outbox-pending").length'),0,'the reconciled send is the committed bubble, not an optimistic one');
 await browser('screenshot',decodeURIComponent(new URL('portal-outbox-reconciled.png',artifacts).pathname));

 console.log('PASS: bot.message renders as a bubble with a task attribution chip while provisional working text never does; a rejected send restores the exact draft with no leftover bubble; a send killed mid-network reconciles through GET /v1/receipts on reload to exactly one committed message.');
}catch(error){
 console.error((await browser('errors').catch(()=>({stdout:'Browser diagnostics unavailable'}))).stdout);
 await browser('screenshot',new URL('../.local/portal-outbox-failure.png',import.meta.url).pathname).catch(()=>{});
 throw error;
}finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
