#!/usr/bin/env node
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`tasks-${randomUUID().slice(0,8)}`,bot='11111111-1111-4111-8111-111111111111',other='99999999-9999-4999-8999-999999999999';
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const click=name=>browser('find','role','button','click','--name',name,'--exact');
// Roster rows carry an avatar initial in their accessible name ("B Beta"); select bots by id.
const choose=persona=>browser('click',`[data-persona-id="${persona}"]`);
const id=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const tasks=Array.from({length:13},(_,n)=>({id:id(n+1),persona_id:bot,title:n===0?'Task A — arrival form':n===1?'Task B — mail check':`Queued task ${n+1}`,role:'coordinator',status:n===0?'running':'waiting',current_attempt:n===0?1:0,error_code:n===0?null:'CAPABILITY_UNAVAILABLE',request_status:'applied'}));
const state={objects:[{id:bot,kind:'persona',body:{name:'Alpha'}},{id:other,kind:'persona',body:{name:'Beta'}}],runs:[],timeline:[],summary:{phase:'READY',execution_enabled:true,queued_runs:0,blocked_runs:12}};
const commands=[];let failTasks=false,delay=null;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://fixture'),path=url.pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/commands'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const command=JSON.parse(Buffer.concat(chunks).toString());commands.push(command);
   assert.equal(command.type,'run.cancel');assert.equal(command.payload.run_id,id(1));tasks[0].status='cancelling';return json({id:randomUUID(),status:'applied'});
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(path==='/v1/state')return json(state);
  if(path.endsWith('/tasks')){
   if(failTasks){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"Synthetic task-feed outage"}}');return;}
   const rows=path.includes(other)?[]:tasks,after=url.searchParams.get('after')??'',eligible=rows.filter(row=>row.id>after),page=eligible.slice(0,10);
   const result={observed_at:'2026-09-14T00:00:00.000Z',counts:{total:rows.length,waiting:rows.filter(row=>row.status==='waiting').length,recovery:0},runs:structuredClone(page),steering:[],recovery:[],output_previews:[],next_cursor:eligible.length>10?page.at(-1).id:null};
   if(delay&&path.includes(bot)){const release=delay;delay=null;await new Promise(ok=>{release.resolve=ok;release.arrived();});}
   return json(result);
  }
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file=portalFiles[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("Tasks 13")');
 await browser('click','#task-strip-summary');
 assert.equal(Number((await browser('get','count','.task-strip-row')).stdout.trim()),10);
 assert.match((await browser('get','text','#task-strip')).stdout,/Task B — mail check · Alpha · Waiting/);
 await browser('screenshot',decodeURIComponent(new URL('portal-tasks-desktop.png',artifacts).pathname));
 await browser('click',`[data-task-id="${id(1)}"]`);
 await browser('wait','--fn',`document.querySelector('[data-run-id="${id(1)}"]')?.open===true`);
 assert.match((await browser('get','text',`[data-run-id="${id(1)}"]`)).stdout,/Request application is not task completion/);
 assert.equal(commands.length,0);
 await browser('click',`[data-run-id="${id(1)}"] .danger`);
 assert.equal(commands.length,0);
 await browser('check','#editor [name=confirm]');
 await browser('click','#editor-form button[type=submit]');
 await browser('wait','--fn','document.querySelector(".timeline").textContent.includes("Cancellation requested, not confirmed")');
 assert.equal(commands.length,1);assert.equal(tasks[1].status,'waiting');
 assert.match((await browser('get','text','#task-strip-summary')).stdout,/Waiting 12/);
 await click('Next task page');await browser('wait','--fn',`!!document.querySelector('[data-run-id="${id(13)}"]')`);
 assert.equal(Number((await browser('get','count','.task-card')).stdout.trim()),3);
 await browser('reload');await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("Tasks 13")');
 await browser('set','viewport','390','844','2');await browser('click','#task-strip-summary');
 await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#task-strip").getBoundingClientRect().bottom<=document.querySelector("#composer").getBoundingClientRect().top')).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-tasks-narrow.png',artifacts).pathname));
 failTasks=true;await browser('click','#refresh');await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("stale")');
 assert.equal(Number((await browser('get','count','.task-strip-row')).stdout.trim()),0);
 await browser('screenshot',decodeURIComponent(new URL('portal-tasks-stale.png',artifacts).pathname));
 failTasks=false;await choose(other);await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("Tasks 0")');
 assert.doesNotMatch((await browser('get','text','#task-strip')).stdout,/Task A|Task B/);
 await browser('screenshot',decodeURIComponent(new URL('portal-tasks-empty.png',artifacts).pathname));
 await choose(bot);await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("Tasks 13")');
 const held={};const arrived=new Promise(ok=>held.arrived=ok);delay=held;
 let timer;
 try{
  // #refresh sits in .sidebar-footer, which is display:none at this narrow (390px)
  // viewport, so the explicit click below may be a no-op there (same on old code).
  // The 10s wait used to be safe only because the old fixed 5s full-refresh timer
  // would independently hit the tasks endpoint well inside that window; ARCHITECTURE_V2
  // A6 replaced that with a 15s fallback poll, so the safety margin must grow to match.
  await browser('click','#refresh');await Promise.race([arrived,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Delayed task request did not arrive')),20000))]);
  await choose(other);assert.doesNotMatch((await browser('get','text','#task-strip')).stdout,/Task A|Task B/);
 }finally{clearTimeout(timer);held.resolve?.();}
 await browser('wait','--fn','document.querySelector("#task-strip-summary").textContent.includes("Tasks 0")');
 assert.doesNotMatch((await browser('get','text','#task-strip')).stdout,/Task A|Task B/);
 assert.equal(commands.length,1);
 console.log('PASS: independent task feed despite empty newest-run snapshot, owner/status/receipt detail, exact A cancellation preserves B and attention, pagination/reload, delayed old-conversation rejection, composer-adjacent narrow layout, stale/empty states; only one explicit cancellation mutation.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
