#!/usr/bin/env node
// Real rendered portal, synthetic owner commands only; no native/account activity.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const a='33333333-3333-4333-8333-333333333333',b='44444444-4444-4444-8444-444444444444';
const session=`steer-${randomUUID().slice(0,8)}`;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}},{id:other,kind:'persona',body:{name:'Inbox'}}],
 runs:[{id:a,title:'Form A',persona_id:bot,role:'background',status:'running',current_attempt:3},{id:b,title:'Hotels B',persona_id:bot,role:'background',status:'running',current_attempt:1}],
 steering:[],summary:{phase:'READY',execution_enabled:true,queued_runs:0,blocked_runs:0}};
const commands=[];
const server=createServer(async(req,res)=>{
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('FIXTURE_BODY_LIMIT');}
   const command=JSON.parse(body);commands.push(command);const id=randomUUID();
   if(command.type==='run.steer')state.steering.push({command_id:id,run_id:command.payload.run_id,attempt:command.payload.expected_attempt,status:'pending',created_at:'2026-09-14T00:00:00.000Z'});
   else assert.equal(command.type,'run.followup');
   return json({id,status:'applied'});
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state')return json(state);
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){res.writeHead(400);res.end(String(error));}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const card=id=>`.task-card[data-run-id="${id}"]`;
const waitText=async text=>browser('wait','--fn',`document.querySelector('#timeline').textContent.includes(${JSON.stringify(text)})`);
const refresh=async text=>{await browser('click','#refresh');await waitText(text);};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await browser('wait','--fn','document.querySelector("#connection").textContent==="Connected"');
 await browser('click',`${card(a)} summary`);await browser('click',`${card(b)} summary`);
 await browser('click',`${card(a)} [data-action="steer"]`);
 assert.match((await browser('get','text','#editor')).stdout,/does not undo effects/);
 await browser('fill','[name="text"]','Use tomorrow for form A only');
 await browser('screenshot',decodeURIComponent(new URL('portal-steering-editor.png',artifacts).pathname));
 await browser('click','#editor-form button[type="submit"]');await waitText('awaits native acknowledgement');
 assert.deepEqual(commands[0],{schema_version:1,type:'run.steer',payload:{run_id:a,expected_attempt:3,text:'Use tomorrow for form A only'}});
 assert.equal((await browser('eval',`document.querySelector('${card(a)}').open`)).stdout.trim(),'true');
 assert.equal((await browser('is','enabled',`${card(a)} [data-action="steer"]`)).stdout.trim(),'false');
 assert.equal((await browser('is','enabled',`${card(b)} [data-action="steer"]`)).stdout.trim(),'true');
 assert.match((await browser('get','text',`${card(b)} .actions button:nth-child(2)`)).stdout,/Follow up after settlement/);
 await browser('click',`${card(b)} .actions button:nth-child(2)`);
 assert.match((await browser('get','text','#editor')).stdout,/waits for native settlement/);
 await browser('fill','[name="text"]','After B finishes check its receipt');await browser('click','#editor-form button[type="submit"]');
 await browser('wait','--fn','!document.querySelector("#editor").open');
 assert.deepEqual(commands[1],{schema_version:1,type:'run.followup',payload:{run_id:b,text:'After B finishes check its receipt'}});
 state.steering[0].status='accepted';await refresh('Understanding and completion are not yet verified');
 assert.equal((await browser('is','enabled',`${card(a)} [data-action="steer"]`)).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-steering-accepted.png',artifacts).pathname));
 state.steering[0].status='outcome_unknown';await refresh('delivery is uncertain');
 assert.equal((await browser('is','enabled',`${card(a)} [data-action="steer"]`)).stdout.trim(),'false');
 await browser('set','viewport','390','844','2');await browser('eval',`document.querySelector('${card(a)}').scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 assert.equal((await browser('eval',`document.querySelector('#timeline').getBoundingClientRect().bottom<=document.querySelector('#composer').getBoundingClientRect().top`)).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-steering-uncertain-narrow.png',artifacts).pathname));
 state.steering[0].status='not_delivered';state.runs[0].status='completed';await refresh('was not delivered');
 assert.equal(Number((await browser('get','count',`${card(a)} [data-action="steer"]`)).stdout.trim()),0);
 await browser('set','viewport','1280','900','2');await browser('click','#bots button:nth-child(2)');await browser('wait','--fn','document.querySelector("#conversation-name").textContent==="Inbox"');
 assert.equal(Number((await browser('get','count','.task-card')).stdout.trim()),0);
 state.summary.execution_enabled=false;await browser('click','#bots button:nth-child(1)');await waitText('Form A');await refresh('Form A');
 await browser('wait','--fn','!document.querySelector("#runtime-banner").hidden');
 assert.equal(Number((await browser('get','count','.task-card [data-action="steer"]')).stdout.trim()),0);
 assert.equal(commands.length,2);
 console.log('PASS: exact attempt steering vs deferred followup; pending/accepted/unknown/late receipts; sibling untouched, expanded cards preserved, cross-bot and production gates; narrow layout; two synthetic commands.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
