#!/usr/bin/env node
// Real Chromium, synthetic read-only API. No accounts, dispatch or provider calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`rhistory-${randomUUID().slice(0,8)}`,bot=randomUUID(),other=randomUUID();
const id=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const routine={id:randomUUID(),kind:'routine',revision:3,body:{persona_id:bot,name:'Travel review',instructions:'Read-only synthetic review',enabled:true,schedule:{cron:'0 8 * * 1',timezone:'Asia/Jakarta'}}};
const sibling={...routine,id:randomUUID(),body:{...routine.body,name:'Empty routine'}};
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}},{id:other,kind:'persona',body:{name:'Finance'}},routine,sibling],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const statuses=['running','completed','failed','cancelled','waiting','finishing','cancelling','recovery_required','queued','claimed','completed','waiting','failed'];
const runs=statuses.map((status,n)=>({id:id(n+1),routine_id:routine.id,persona_id:bot,title:`Review ${n+1}`,status,current_attempt:2,request_status:'applied',created_at:`2026-09-${String((n*7)%20+1).padStart(2,'0')}T00:00:00Z`,error_code:status==='waiting'?'CAPABILITY_UNAVAILABLE':null}));
runs[0].captured_routine_revision=1;
runs[1].captured_routine_revision=null;
const requests=[],violations=[];let fail=false,offline=false,held=null,malformed=false;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const named=name=>browser('find','role','button','click','--name',name,'--exact');
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const panel='.routine-history';
const text=async()=>await evaluate(`document.querySelector('${panel}')?.textContent??''`);
const ready=()=>wait(`document.querySelector('${panel} [data-run-id="${id(1)}"]')!==null`);
const open=async()=>{await click('[data-action="routine-history"]');await ready();};
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  assert.equal(req.method,'GET','History workflow must not mutate');
  const url=new URL(req.url,'http://fixture'),path=url.pathname;
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(path.startsWith('/v1/routines/')){
   requests.push(req.url);assert.ok([routine.id,sibling.id].some(key=>path===`/v1/routines/${key}/runs`));assert.equal(url.searchParams.get('limit'),'10');assert.ok([...url.searchParams.keys()].every(key=>['after','limit'].includes(key)));
   if(fail)return json({error:{message:'Synthetic history read failed'}},503);
   const all=path.includes(sibling.id)?[]:runs,after=url.searchParams.get('after'),eligible=all.filter(row=>!after||row.id>after),page=eligible.slice(0,10);
   const result={observed_at:'2026-09-17T00:00:00Z',counts:{total:all.length,waiting:all.filter(r=>r.status==='waiting').length,recovery:all.filter(r=>r.status==='recovery_required').length},runs:structuredClone(page),next_cursor:eligible.length>10?page.at(-1).id:null,steering:[{run_id:id(1),attempt:2,status:'outcome_unknown'}],recovery:[{run_id:id(8),attempt:2,executor_terminated:false}],output_previews:[{run_id:id(1),attempt:1,text:'OLD ATTEMPT MUST NOT APPEAR'},{run_id:id(1),attempt:2,text:'Current provisional finding <script>not HTML</script>',truncated:true},{run_id:id(2),attempt:2,text:'TERMINAL PREVIEW MUST NOT APPEAR'}]};
   if(malformed)result.runs[0].routine_id=sibling.id;
   if(held){const gate=held;held=null;await new Promise(ok=>{gate.release=ok;gate.arrived();});}
   return json(result);
  }
  if(path.endsWith('/tasks'))return json({observed_at:'2026-09-17T00:00:00Z',counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){violations.push(error.message);json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async(name,anchor=panel)=>{await browser('eval',`document.querySelector(${JSON.stringify(anchor)}).scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',new URL(`routine-history-${name}.png`,artifacts).pathname);};
const late=async action=>{
 let arrived;const arrival=new Promise(ok=>arrived=ok),gate={arrived};held=gate;
 await click('[data-action="routine-history"]');
 let timer;try{await Promise.race([arrival,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Held request missing')),10000))]);await action();}finally{clearTimeout(timer);gate.release?.();}
 await refresh();assert.equal(await evaluate(`document.querySelector('${panel} [data-run-id]')===null`),true);
};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');
 assert.equal(requests.length,0);await open();
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${panel} [data-run-id]'),n=>n.dataset.runId)`),Array.from({length:10},(_,n)=>id(n+1)));
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${panel} .task-card>summary'),n=>n.textContent)`),['Review 1 · Working','Review 2 · Completed','Review 3 · Failed','Review 4 · Cancelled','Review 5 · Waiting','Review 6 · Saving result','Review 7 · Cancelling','Review 8 · Needs recovery','Review 9 · Queued','Review 10 · Starting']);
 assert.equal(requests[0],`/v1/routines/${routine.id}/runs?limit=10`);
 assert.match(await evaluate(`document.querySelector('${panel} [data-run-id="${id(1)}"]').textContent`),/Captured routine revision: 1 for current attempt/);
 assert.match(await evaluate(`document.querySelector('${panel} [data-run-id="${id(2)}"]').textContent`),/Captured routine revision unavailable/);
 assert.match(await text(),/Total 13 · Waiting 2 · Recovery 1/);assert.match(await text(),/not newest first/);
 assert.doesNotMatch(await text(),/OLD ATTEMPT|TERMINAL PREVIEW/);
 assert.equal(await evaluate(`document.querySelector('${panel} script')===null`),true);
 await click(`${panel} [data-run-id="${id(1)}"] summary`);await capture('desktop');
 await click(`${panel} [data-run-id="${id(2)}"] summary`);await capture('revision-unavailable',`${panel} [data-run-id="${id(2)}"]`);
 await browser('set','viewport','390','844','2');await click('#show-details');await capture('revision-narrow',`${panel} [data-run-id="${id(1)}"]`);await click('#close-details');await browser('set','viewport','1280','900','2');
 assert.match(await text(),/Steering delivery: outcome_unknown/);assert.match(await text(),/does not verify delivery or safe sleep/);
 await refresh();assert.equal(requests.length,1);assert.equal(await evaluate(`document.querySelector('${panel} [data-run-id="${id(1)}"]').open`),true);
 assert.equal(await evaluate('document.querySelector("#task-strip-summary").textContent.includes("Tasks 0")'),true);
 await named('Next history page');await wait(`!!document.querySelector('${panel} [data-run-id="${id(13)}"]')`);
 assert.equal(requests[1],`/v1/routines/${routine.id}/runs?after=${id(10)}&limit=10`);
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${panel} [data-run-id]'),n=>n.dataset.runId)`),[id(11),id(12),id(13)]);
 assert.match(await text(),/Review 11 · Completed/);assert.match(await text(),/Review 12 · Waiting/);assert.match(await text(),/Review 13 · Failed/);
 await browser('set','viewport','390','844','2');await click('#show-details');await capture('narrow');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 fail=true;await named('First history page');await wait(`!!document.querySelector('${panel} [role="alert"]')`);assert.doesNotMatch(await text(),/Review 11/);await capture('error');fail=false;
 await click('[data-action="routine-history"]');await open();await browser('eval','window.dispatchEvent(new Event("offline"))');assert.doesNotMatch(await text(),/Current provisional/);assert.match(await text(),/offline/);await capture('offline');await refresh();assert.doesNotMatch(await text(),/Current provisional/);
 await click('[data-action="routine-history"]');
 await browser('eval','document.querySelectorAll("[data-action=routine-history]")[1].click()');await wait(`document.querySelector('${panel}')?.textContent.includes('No retained runs')`);await capture('empty');
 assert.equal(requests.at(-1),`/v1/routines/${sibling.id}/runs?limit=10`);await browser('eval','document.querySelectorAll("[data-action=routine-history]")[1].click()');
 await browser('set','viewport','1280','900','2');
 // A stale revision invalidates both retained rows and responses in flight.
 await open();routine.revision++;await refresh();assert.equal(await evaluate(`!document.querySelector('${panel}')`),true);
 await late(async()=>{await capture('loading');routine.revision++;await refresh();});
 await late(async()=>{state.objects=state.objects.filter(row=>row.id!==routine.id);await refresh();});state.objects.push(routine);await refresh();
 // Put the owned routine first again; the DOM locator deliberately uses the existing cards.
 state.objects=state.objects.filter(row=>row.id!==routine.id&&row.id!==sibling.id).concat(routine,sibling);await refresh();
 await late(async()=>{await click(`[data-persona-id="${other}"]`);});
 await click(`[data-persona-id="${bot}"]`);await refresh();
 await late(async()=>{await click('[data-action="routine-history"]');});
 await late(async()=>{offline=true;await refresh();offline=false;await refresh();});
 await click('[data-action="routine-history"]');
 malformed=true;await click('[data-action="routine-history"]');await wait(`document.querySelector('${panel}')?.textContent.includes('Invalid routine history')`);assert.equal(await evaluate(`!document.querySelector('${panel} [data-run-id]')`),true);malformed=false;
 // Transition to owner-alpha also invalidates pending reads, then blocks every new one.
 await click('[data-action="routine-history"]');
 await late(async()=>{state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:'2099-01-01T00:00:00Z',max_runs:3,admitted_runs:0,max_task_seconds:60};await refresh();});
 const count=requests.length;assert.equal(await evaluate('document.querySelectorAll("[data-action=routine-history]").length'),0);await refresh();await browser('reload');await wait('document.querySelector("#connection").textContent==="Connected"');assert.equal(requests.length,count);
 assert.equal(await evaluate('document.querySelectorAll("[data-action=routine-history]").length'),0);assert.deepEqual(violations,[]);
 console.log('PASS: exact routine GET scopes; UUID-exclusive 10+3 pages (not date order); all statuses; current-attempt provisional text; delivery/settlement caveats; unfinished conversation feed unchanged; no polling/mutations; empty/error/offline/stale/deleted/hidden/persona/alpha late-response fences; owner-alpha zero new history reads; desktop and 390px Chromium layout.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
