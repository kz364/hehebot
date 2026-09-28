#!/usr/bin/env node
// Synthetic Chromium only. Disable the five-second timer to count explicit refresh traffic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const own={id:'33333333-3333-4333-8333-333333333333',kind:'memory',revision:7,body:{text:'Quiet room for late arrivals.',scope:{kind:'persona',id:bot},sensitivity:'sensitive',expires_at:'2091-03-17T04:23:11.000Z',source_event_id:'44444444-4444-4444-8444-444444444444'}};
const global={id:'55555555-5555-4555-8555-555555555555',kind:'memory',revision:19,body:{text:'Prefer train travel.',scope:{kind:'global',id:null},sensitivity:'ordinary',expires_at:null,source_event_id:'66666666-6666-4666-8666-666666666666'}};
const foreign={id:'77777777-7777-4777-8777-777777777777',kind:'memory',revision:23,body:{text:'Finance-only preference.',scope:{kind:'persona',id:other},sensitivity:'secret',expires_at:'2084-09-03T21:17:00Z',source_event_id:'88888888-8888-4888-8888-888888888888'}};
const missing={kind:'memory',body:{text:'Legacy record with unknown metadata.',scope:{kind:'global'}}};
const hostile='<img src="/injected" onerror="window.metadataExecuted=true">';
const injected={id:hostile,kind:'memory',revision:hostile,body:{text:'Untrusted metadata fixture.',scope:{kind:'global',id:hostile},sensitivity:hostile,expires_at:hostile,source_event_id:hostile}};
const identities=[{id:bot,kind:'persona',revision:3,body:{name:'Travel'}},{id:other,kind:'persona',revision:5,body:{name:'Finance'}}];
const state={objects:[...identities,own,global,foreign,missing,injected],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const requests=[],session=`inspect-${randomUUID().slice(0,8)}`;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;requests.push(`${req.method} ${path}`);
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/v1/state')return json(state);
 if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
 if(path.endsWith('/events'))return json({events:[],has_more:false});
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
 if(!file){res.writeHead(404);res.end();return;}
 let content=await readFile(new URL(`../public/${file}`,import.meta.url),'utf8');
 if(file==='index.html')content=content.replace('<head>','<head><script>window.setInterval=()=>0;</script>');
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(content);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
let refreshNumber=0;
const refresh=async()=>{
 state.provider={id:`Inspection refresh ${++refreshNumber}`};
 const start=requests.length;
 await browser('click','#refresh');
 await wait(`document.querySelector('#runtime-provider').textContent===${JSON.stringify(state.provider.id)}`);
 assert.deepEqual(requests.slice(start),['GET /v1/state',`GET /v1/conversations/${bot}/events`,`GET /v1/conversations/${bot}/tasks`],'only existing refresh reads');
};
const navigate=async id=>{
 state.provider={id:`Navigation ${++refreshNumber}`};
 await browser('click',`[data-persona-id="${id}"]`);
 await wait(`document.querySelector('#runtime-provider').textContent===${JSON.stringify(state.provider.id)}`);
};
const selector=index=>`#memories .card:nth-child(${index}) details`;
const metadata=index=>evaluate(`Array.from(document.querySelector(${JSON.stringify(selector(index))}).querySelectorAll('p'),p=>p.textContent)`);
const open=async index=>{await browser('click',`${selector(index)} > summary`);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector(index))}).open`),true);};
const capture=async name=>{
 assert.equal(await evaluate('devicePixelRatio'),2);
 await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await browser('screenshot',decodeURIComponent(new URL(name,artifacts).pathname));
};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await wait('document.querySelector("#connection").textContent==="Connected"');await refresh();
 assert.equal(await evaluate('document.querySelectorAll("#memories .card").length'),4);
 assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),0);
 assert.equal(await evaluate('document.querySelector("#memories").textContent.includes("Finance-only")'),false);
 assert.deepEqual(await metadata(1),[`ID: ${own.id}`,'Revision: 7','Scope kind: persona',`Scope ID: ${bot}`,'Sensitivity: sensitive','Expiry: 2091-03-17T04:23:11.000Z',`Source event ID: ${own.body.source_event_id}`,'Source identity only; source text is not retrieved.']);
 assert.deepEqual(await metadata(2),[`ID: ${global.id}`,'Revision: 19','Scope kind: global','Scope ID: None (null)','Sensitivity: ordinary','Expiry: None',`Source event ID: ${global.body.source_event_id}`,'Source identity only; source text is not retrieved.']);
 assert.deepEqual(await metadata(3),['ID: Unknown (not provided)','Revision: Unknown (not provided)','Scope kind: global','Scope ID: Unknown (not provided)','Sensitivity: Unknown (not provided)','Expiry: Unknown (not provided)','Source event ID: Unknown (not provided)','Source identity only; source text is not retrieved.']);
 assert.deepEqual((await metadata(4)).slice(0,7),[`ID: ${hostile}`,`Revision: ${hostile}`,'Scope kind: global',`Scope ID: ${hostile}`,`Sensitivity: ${hostile}`,`Expiry: ${hostile}`,`Source event ID: ${hostile}`]);
 assert.equal(await evaluate('document.querySelectorAll("#memories img").length'),0);
 assert.equal(await evaluate('window.metadataExecuted===true'),false);
 const before=requests.length;
 await capture('portal-memory-inspect-collapsed.png');
 await browser('focus',`${selector(1)} > summary`);await browser('press','Enter');
 assert.equal(await evaluate(`document.querySelector('${selector(1)}').open`),true);
 await capture('portal-memory-inspect-desktop.png');
 await browser('press','Space');assert.equal(await evaluate(`document.querySelector('${selector(1)}').open`),false);
 await open(2);await open(3);await open(4);
 assert.equal(requests.length,before,'disclosures, keyboard and screenshots make no requests');
 console.log('PASS exact asymmetric metadata, null versus missing, hostile text, Enter/Space; zero inspection requests.');
 await refresh();assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),3,'unchanged refresh preserves inspection');
 for(const index of [2,3,4]){
  await browser('focus',`${selector(index)} > summary`);await browser('press','Enter');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector(index))}).open`),false);
 }
 await open(1);
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#memories details"),d=>d.open)'),[true,false,false,false]);
 own.revision=8;own.body.source_event_id='99999999-9999-4999-8999-999999999999';await refresh();
 assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),0,'changed metadata closes prior inspection');
 assert.equal((await metadata(1))[1],'Revision: 8');assert.equal((await metadata(1))[6],`Source event ID: ${own.body.source_event_id}`);
 await open(1);state.objects=state.objects.filter(row=>row!==own);await refresh();
 assert.equal(await evaluate(`document.querySelector('#memories').textContent.includes('${own.id}')`),false);
 assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),0);
 await open(1);await navigate(other);
 assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),0);
 assert.equal((await metadata(2))[1],'Revision: 23');
 assert.equal((await metadata(2))[3],`Scope ID: ${other}`);
 await navigate(bot);await refresh();
 assert.equal(await evaluate('document.querySelectorAll("#memories details[open]").length'),0);
 assert.equal(await evaluate('document.querySelector("#memories").textContent.includes("Finance-only")'),false);
 console.log('PASS unchanged refresh preserves inspection; revision replacement, deletion and persona navigation discard stale disclosures.');
 await browser('set','viewport','390','844','2');await browser('click','#show-details');await open(1);await open(2);
 await browser('eval','document.querySelector("#memories").scrollIntoView({block:"start"})');
 await capture('portal-memory-inspect-narrow.png');
 assert.equal(await evaluate('document.querySelector("#details").scrollWidth<=document.querySelector("#details").clientWidth'),true);
 assert.equal(requests.filter(row=>row.startsWith('POST ')).length,0);
 assert.ok(requests.filter(row=>row.includes('/v1/')).every(row=>/^GET \/v1\/(state|conversations\/[\w-]+\/(events|tasks))$/.test(row)));
 console.log('PASS DPR2 desktop/narrow disclosures, no horizontal overflow; zero commands and no extra context/source fetches.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
