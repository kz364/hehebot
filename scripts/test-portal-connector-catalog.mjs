#!/usr/bin/env node
// Real Chromium, synthetic HTTP only. No connector probes or live services.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`catalog-${randomUUID().slice(0,8)}`,id=randomUUID();
const state={objects:[{id,kind:'persona',revision:1,body:{name:'Travel'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0},skill_proposals:[],skill_enablements:[]};
const baseline={scope:'bundled-diagnostic-baseline',runtime_inventory:'unobserved',authority:'not-granted',catalog:JSON.parse(await readFile(new URL('../config/connector-catalog.json',import.meta.url),'utf8'))};
const requests=[],failures=[];let mode='ok',offline=false,pending=[];
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const click=selector=>browser('eval',`document.querySelector(${JSON.stringify(selector)}).click()`);
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const catalogCount=()=>requests.filter(x=>x==='GET /v1/connectors/catalog').length;
const manual=()=>click('#timeline button');
const text=()=>evaluate('document.querySelector("#timeline").textContent');
const loaded=()=>wait('document.querySelector("#timeline").textContent.includes("Recent messages — incompatible")');
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 try{
  requests.push(`${req.method} ${req.url}`);assert.equal(req.method,'GET');
  if(req.url==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(req.url==='/v1/connectors/catalog'){
   if(mode==='late'){pending.push(()=>json(baseline));return;}
   if(mode==='error')return json({error:{message:'Synthetic catalog unavailable'}},503);
   if(mode==='malformed')return json({...baseline,catalog:{whatsapp:{}}});
   const copy=structuredClone(baseline);if(mode==='hostile'){copy.catalog.whatsapp.source='javascript:alert(1)';copy.catalog.whatsapp.prerequisites.push('<img src="https://invalid.example/canary" onerror="alert(1)">');}return json(copy);
  }
  if(req.url===`/v1/conversations/${id}/events`)return json({events:[],has_more:false,pruned_through:0});
  if(req.url===`/v1/conversations/${id}/tasks`)return json({counts:{total:0,waiting:0,recovery:0},runs:[],output_previews:[],steering:[],recovery:[],next_cursor:null});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[req.url];
  if(!file){assert.equal(req.url,'/favicon.ico');res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(e){failures.push(e.message);json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async name=>{await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await browser('screenshot',decodeURIComponent(new URL(`connector-catalog-${name}.png`,artifacts).pathname));};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');assert.equal(catalogCount(),0);
 await click('#show-connectors');await loaded();assert.equal(catalogCount(),1);assert.match(await text(),/Scoped search — synthetic-verified/);assert.match(await text(),/Scoped search is not recent-history coverage/);assert.match(await text(),/Runtime inventory is unobserved/);
 assert.equal(await evaluate('["composer","details","task-strip","conversation-search-panel","edit-bot","show-details"].every(id=>document.getElementById(id).hidden)'),true);assert.equal(await evaluate('document.querySelector("#timeline").scrollTop'),0);await capture('desktop');
 await browser('set','viewport','390','844','2');await capture('narrow');await browser('set','viewport','1280','900','2');
 await refresh();await refresh();assert.equal(catalogCount(),1);assert.equal(await evaluate('document.querySelector("#conversation-name").textContent'),'Connectors');
 await browser('reload');await loaded();assert.equal(catalogCount(),2);
 mode='hostile';await manual();await wait('document.querySelector("#timeline").textContent.includes("javascript:alert")');assert.match(await text(),/<img src=/);assert.equal(await evaluate('document.querySelectorAll("#timeline img,#timeline a").length'),0);
 for(const bad of ['error','malformed']){mode=bad;await manual();await wait('!!document.querySelector("#timeline [role=alert]")');assert.doesNotMatch(await text(),/Pinned package:/);await capture(bad);}
 mode='late';await manual();await wait('document.querySelector("#timeline").textContent.includes("Loading bundled")');await capture('loading');
 await click('#show-skills');await wait('document.querySelector("#conversation-name").textContent==="Skills"');pending.splice(0).forEach(fn=>fn());await refresh();assert.match(await text(),/Reviewed procedures/);assert.doesNotMatch(await text(),/Pinned package:/);
 mode='ok';await click('#show-connectors');await loaded();const beforeOffline=catalogCount();
 offline=true;await refresh();assert.match(await text(),/unavailable offline/);assert.doesNotMatch(await text(),/Pinned package:/);await manual();assert.equal(catalogCount(),beforeOffline);
 offline=false;await refresh();assert.match(await text(),/Select Refresh catalog/);assert.equal(catalogCount(),beforeOffline);await manual();await loaded();
 mode='late';await manual();await wait('document.querySelector("#timeline").textContent.includes("Loading bundled")');
 await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,value:false});dispatchEvent(new Event("offline"))');assert.match(await text(),/unavailable offline/);pending.splice(0).forEach(fn=>fn());await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,value:true})');await refresh();assert.doesNotMatch(await text(),/Pinned package:/);
 mode='ok';await manual();await loaded();await click(`[data-persona-id="${id}"]`);await wait('!document.querySelector("#composer").hidden');assert.equal(await evaluate('document.querySelector("#conversation-name").textContent'),'Travel');
 mode='late';await click('#show-connectors');await wait('document.querySelector("#timeline").textContent.includes("Loading bundled")');
 state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:id,expires_at:new Date(Date.now()+3600000).toISOString(),max_runs:3,admitted_runs:0,max_task_seconds:90};await refresh();const alphaCount=catalogCount();pending.splice(0).forEach(fn=>fn());await refresh();assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);assert.doesNotMatch(await text(),/Pinned package:/);await manual();await click('#show-connectors');assert.equal(catalogCount(),alphaCount);
 delete state.summary.owner_alpha;delete state.summary.owner_alpha_session;await refresh();await manual();assert.equal(catalogCount(),alphaCount);assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);
 state.summary.owner_alpha=true;await browser('reload');await wait('document.querySelector("#connection").textContent==="Connected"');assert.equal(catalogCount(),alphaCount);
 assert.deepEqual(failures,[]);assert.equal(requests.some(x=>x.includes('/conversations/connectors')||x.includes('/commands')),false);
 console.log('Connector catalog Chromium: PASS — exact GET scope, no commands/polling, asymmetric baseline, literal hostile text, malformed/error/loading, offline/reconnect, navigation/late, reload and alpha latch; desktop/390px at 2x.');
}finally{pending.splice(0).forEach(fn=>fn());await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
