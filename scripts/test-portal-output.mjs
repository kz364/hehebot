#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`output-${randomUUID().slice(0,8)}`,bot='11111111-1111-4111-8111-111111111111';
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const root='22222222-2222-4222-8222-222222222222',child='33333333-3333-4333-8333-333333333333';
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}}],runs:[
 {id:root,persona_id:bot,title:'Plan itinerary',role:'coordinator',status:'finishing',current_attempt:1},
 {id:child,persona_id:bot,title:'Check arrival requirements',role:'background',status:'running',current_attempt:1}],
 output_previews:[{run_id:root,attempt:1,version:1,text:'The itinerary draft is ready. Arrival checks are still running.',truncated:false},
 {run_id:child,attempt:1,version:1,text:'Checking the arrival form. No form has been submitted.\n<img src=x onerror="window.executed=true">',truncated:true}],
 timeline:[],summary:{phase:'READY',execution_enabled:true,queued_runs:0,blocked_runs:0}};
let mutations=0;
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){mutations++;res.writeHead(405);res.end();return;}
  const path=new URL(req.url,'http://fixture').pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/state')return json(state);
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','1100','2');
 await browser('wait','--fn','document.querySelectorAll(".output-preview").length===2');
 assert.equal((await browser('eval','document.querySelector(".output-preview").checkVisibility()')).stdout.trim(),'false');
 for(const id of [root,child])await browser('click',`[data-run-id="${id}"] summary`);
 assert.match((await browser('get','text',`[data-run-id="${child}"]`)).stdout,/Preview shortened/);
 assert.equal((await browser('eval','document.querySelectorAll(".output-preview img").length===0&&!window.executed')).stdout.trim(),'true');
 await browser('eval','document.querySelector(".timeline").style.scrollBehavior="auto";document.querySelector(".task-card").scrollIntoView({behavior:"instant",block:"start"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 await browser('screenshot',new URL('portal-output-desktop.png',artifacts).pathname);
 state.output_previews[1]={...state.output_previews[1],version:2,text:'The arrival check needs reconciliation. No submission receipt is confirmed.',truncated:false};
 state.runs[1].status='recovery_required';
 await browser('click','#refresh');await browser('wait','--fn','document.querySelector(".timeline").textContent.includes("No submission receipt is confirmed")');
 assert.equal((await browser('eval',`document.querySelector('[data-run-id="${child}"]').open`)).stdout.trim(),'true');
 await browser('set','viewport','390','844','2');
 await browser('eval',`document.querySelector('[data-run-id="${child}"]').scrollIntoView({behavior:"instant",block:"start"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 await browser('screenshot',new URL('portal-output-narrow.png',artifacts).pathname);
 state.runs[0].status='completed';state.runs[1].status='cancelling';
 await browser('click','#refresh');await browser('wait','--fn','document.querySelectorAll(".output-preview").length===0');
 state.runs[1].status='running';state.runs[1].current_attempt=2;
 await browser('click','#refresh');await browser('wait','--fn','document.querySelectorAll(".output-preview").length===0');
 assert.equal((await browser('eval','JSON.stringify(localStorage).includes("arrival check")')).stdout.trim(),'false');
 assert.equal(mutations,0);
 console.log('PASS: exact root/child previews, provisional and truncation labels, literal untrusted text, polling refresh preserves expansion, recovery/narrow layout, terminal/cancellation/old-attempt hiding, zero mutations.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
