#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`results-${randomUUID().slice(0,8)}`,bot=randomUUID(),other=randomUUID();
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const payloads=[
 {status:'failed',error_code:'TEMPORARY_UNAVAILABLE',title:'Arrival check',text:''},
 {status:'waiting',title:'Draft review',text:'Choose a draft before continuing.'},
 {status:'cancelled',error_code:'OWNER_CANCELLED',role:'background',text:''},
 {status:'completed',title:'Mail check',text:'No new mail.'},
 {text:'Older result without a retained status.'},
];
const events=payloads.map((payload,index)=>({id:randomUUID(),sequence:index+1,conversation_id:bot,type:'run.result',created_at:'2026-09-14T00:00:00.000Z',payload:{run_id:randomUUID(),...payload}}));
const state={objects:[{id:bot,kind:'persona',body:{name:'Alpha'}},{id:other,kind:'persona',body:{name:'Beta'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let mutations=0;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.method!=='GET'){mutations++;res.writeHead(405);res.end();return;}
  if(path==='/v1/state')return json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:path.includes(bot)?events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const wait=()=>browser('wait','--fn','document.querySelectorAll(".result-outcome").length===5');
const labels=async()=>JSON.parse((await browser('eval','[...document.querySelectorAll(".result-outcome")].map(x=>x.textContent)')).stdout);
const top=()=>browser('eval','document.querySelector("#timeline").scrollTo({top:0,behavior:"instant"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','1050','2');await wait();
 const expected=['Recorded outcome: Failed · TEMPORARY_UNAVAILABLE · Arrival check','Recorded outcome: Waiting · Draft review','Recorded outcome: Cancelled · OWNER_CANCELLED · Background task','Recorded outcome: Completed · Mail check','Recorded outcome: Unavailable'];
 assert.deepEqual(await labels(),expected);await top();await browser('screenshot',decodeURIComponent(new URL('portal-results-desktop.png',artifacts).pathname));
 await browser('click','#refresh');await wait();assert.deepEqual(await labels(),expected);
 await browser('reload');await wait();assert.deepEqual(await labels(),expected);
 await browser('click',`[data-persona-id="${other}"]`);await browser('wait','--fn','document.querySelector("h1").textContent==="Beta"');
 assert.equal(Number((await browser('get','count','.result-outcome')).stdout.trim()),0);
 await browser('click',`[data-persona-id="${bot}"]`);await wait();assert.deepEqual(await labels(),expected);
 await browser('set','viewport','390','844','2');await top();await browser('screenshot',decodeURIComponent(new URL('portal-results-narrow.png',artifacts).pathname));
 assert.equal((await browser('eval','document.querySelector("#timeline").getBoundingClientRect().bottom<=document.querySelector("#task-strip").getBoundingClientRect().top&&document.querySelector("#timeline").scrollHeight>document.querySelector("#timeline").clientHeight')).stdout.trim(),'true');
 for(const [index,name] of [[1,'waiting'],[4,'last']]){
  // ARCHITECTURE_V2 A7: a run.result outcome is a non-bubble notice (`div.event`), not an
  // `article` — only the legacy fallback for a pre-V1 completed run without a bot.message
  // renders an article. Match either container.
  await browser('eval',`document.querySelectorAll('.result-outcome')[${index}].closest('article,.event').scrollIntoView({block:'start',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await browser('screenshot',decodeURIComponent(new URL(`portal-results-narrow-${name}.png`,artifacts).pathname));
 }
 events[0].payload.title='<img src=x onerror=alert(1)>'+ 'x'.repeat(150);await browser('click','#refresh');
 await browser('wait','--fn','document.querySelector(".result-outcome").textContent.includes("<img")');
 assert.equal(Number((await browser('get','count','#timeline img')).stdout.trim()),0);
 assert.equal((await browser('eval','document.querySelector("#timeline").scrollWidth<=document.querySelector("#timeline").clientWidth&&document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 assert.equal(mutations,0);
 console.log('PASS: persisted failed/waiting/cancelled/completed and unknown outcomes without recent runs; empty results stay visible, attribution retained, refresh/reload dedupe and bot isolation, narrow wrapping, literal untrusted title, zero mutations. Chromium viewport emulation only.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
