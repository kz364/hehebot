#!/usr/bin/env node
// Real Chromium, disposable synthetic GET-only API. Never dispatches a run.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`preflight-${randomUUID().slice(0,8)}`,bot=randomUUID(),other=randomUUID();
const persona={id:bot,kind:'persona',revision:2,body:{name:'Travel'}};
const routine={id:randomUUID(),kind:'routine',revision:7,body:{persona_id:bot,name:'Weekly travel review',instructions:'Synthetic read-only review',enabled:false,schedule:{cron:'17 6 * * 2',timezone:'Asia/Jakarta'},policy:{misfire:'coalesce',overlap:'queue_one',max_replay:2,max_lateness_seconds:7200}}};
const sibling={...structuredClone(routine),id:randomUUID(),body:{...routine.body,name:'Event review',schedule:null}};
const state={objects:[persona,{id:other,kind:'persona',revision:1,body:{name:'Finance'}},routine,sibling],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const blockers=[{code:'FORBIDDEN',message:'A routine action policy is no longer authorized.'},{code:'RESOURCE_BUSY',message:'This routine already has unfinished work.'},{code:'PERSONA_ARCHIVED',message:'Synthetic archived persona <script>not markup</script>'}];
let permitted=false,execution=true,fail=false,offline=false,held=null,mismatch=null;
const reads=[],writes=[],violations=[];
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const panel='.routine-preflight',toggle='[data-action="routine-preflight"]';
const text=()=>evaluate(`document.querySelector('${panel}')?.textContent??''`);
const close=()=>click(toggle);
const open=async()=>{await click(toggle);await wait(`document.querySelector('${panel}')?.textContent.includes('Observed')`);};
const runDisabled=()=>evaluate(`Array.from(document.querySelectorAll('#routines .actions button')).filter(b=>b.textContent==='Run now').map(b=>b.disabled)`);
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  if(req.method!=='GET')writes.push(req.url);assert.equal(req.method,'GET','Preflight must never write');
  const url=new URL(req.url,'http://fixture'),path=url.pathname;
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(path.endsWith('/preflight')){
   reads.push(req.url);assert.equal(url.search,'');const r=[routine,sibling].find(r=>path===`/v1/routines/${r.id}/preflight`);assert.ok(r);
   if(fail)return json({error:{message:'Synthetic preflight unavailable'}},503);
   const result={routine_id:r.id,routine_revision:r.revision,persona_id:r.body.persona_id,observed_at:'2026-09-17T00:13:00.000Z',enabled:r.body.enabled,schedule:r.body.schedule,next_times:r.body.schedule?['2026-09-21T23:17:00.000Z','2026-09-28T23:17:00.000Z','2026-10-05T23:17:00.000Z']:[],policy:r.body.policy,manual_run:{command_allowed:permitted,execution_enabled:execution,blockers:permitted?[]:blockers},limitations:['Synthetic limitation: input coverage remains unknown.']};
   if(mismatch)Object.assign(result,mismatch);
   // Snapshot before the hold: state changes cannot silently update the reply.
   const detached=structuredClone(result);
   if(held){const gate=held;held=null;await new Promise(ok=>{gate.release=ok;gate.arrived();});}
   return json(detached);
  }
  if(path.endsWith('/runs'))return json({observed_at:'2026-09-17T00:00:00Z',counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){violations.push(error.message);json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async(name,anchor=panel)=>{await browser('eval',`document.querySelector(${JSON.stringify(anchor)}).scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',new URL(`routine-preflight-${name}.png`,artifacts).pathname);};
const late=async action=>{
 let arrived;const arrival=new Promise(ok=>arrived=ok),gate={arrived};held=gate;
 await click(toggle);let timer;
 try{await Promise.race([arrival,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Held read missing')),10000))]);await action();}finally{clearTimeout(timer);gate.release?.();}
 await refresh();assert.doesNotMatch(await text(),/Observed|Command checks passed|Command blocked/);
};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');
 assert.equal(reads.length,0);const originalRunState=await runDisabled();await open();
 assert.equal(reads[0],`/v1/routines/${routine.id}/preflight`);
 for(const b of blockers)assert.ok((await text()).includes(`${b.code}: ${b.message}`));
 assert.equal(await evaluate(`document.querySelector('${panel} script')===null`),true);
 assert.match(await text(),/Execution enabled — independent/);assert.match(await text(),/Revision 7 · Observed 2026-09-17T00:13:00.000Z \(UTC\)/);
 assert.match(await text(),/22\/09\/2026, 06:17:00 Asia\/Jakarta/);assert.match(await text(),/overlap queue_one · max replay 2 · max lateness 7200s/);
 assert.match(await text(),/Routine paused.*once without resuming/);assert.match(await text(),/Hypothetical.*not admission or delivery promises/);
 assert.match(await text(),/Neither status proves connector credentials, model access, input readiness, effect approvals, execution success or delivery/);
 assert.deepEqual(await runDisabled(),originalRunState);await capture('blocked-desktop');
 const count=reads.length;await refresh();await browser('wait','5200');assert.equal(reads.length,count); // Cross existing state-poll interval.
 await click('[data-action="routine-history"]');await wait('document.querySelector(".routine-history")?.textContent.includes("No retained runs")');assert.match(await text(),/Command blocked/);
 await close();assert.equal(await evaluate('!!document.querySelector(".routine-history")'),true);await open();await click('[data-action="routine-history"]');assert.match(await text(),/Command blocked/);
 await close();permitted=true;execution=false;await open();assert.match(await text(),/Command checks passed at observation: known grant, busy and persona checks only/);assert.match(await text(),/Execution disabled — independent/);assert.doesNotMatch(await text(),/FORBIDDEN|RESOURCE_BUSY/);assert.deepEqual(await runDisabled(),originalRunState);await capture('permitted-desktop');
 await browser('set','viewport','390','844','2');await click('#show-details');await capture('paused-narrow');await capture('schedule-narrow',`${panel} p:nth-of-type(7)`);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await close();await browser('eval','document.querySelectorAll("[data-action=routine-preflight]")[1].click()');await wait(`document.querySelector('${panel}')?.textContent.includes('Event-triggered:')`);assert.doesNotMatch(await text(),/Hypothetical|Asia\/Jakarta/);await capture('event-narrow');await browser('eval','document.querySelectorAll("[data-action=routine-preflight]")[1].click()');
 fail=true;await click(toggle);await wait(`!!document.querySelector('${panel} [role="alert"]')`);assert.match(await text(),/Synthetic preflight unavailable/);assert.doesNotMatch(await text(),/Observed/);await capture('error');fail=false;await close();
 await open();await browser('eval','window.dispatchEvent(new Event("offline"))');assert.match(await text(),/unavailable offline/);assert.doesNotMatch(await text(),/Observed/);await capture('offline');await refresh();assert.doesNotMatch(await text(),/Observed/);await close();
 offline=true;await refresh();const beforeOffline=reads.length;await click(toggle);assert.equal(reads.length,beforeOffline);await close();offline=false;await refresh();
 await browser('set','viewport','1280','900','2');
 await open();routine.revision++;await refresh();assert.equal(await text(),'');
 await late(async()=>{await capture('loading');routine.revision++;await refresh();});
 await late(async()=>{routine.body.persona_id=other;await refresh();});routine.body.persona_id=bot;await refresh();
 await late(async()=>{state.objects=state.objects.filter(r=>r!==routine);await refresh();});state.objects.splice(2,0,routine);await refresh();
 await late(async()=>{persona.revision++;await refresh();});
 await late(async()=>{await click(`[data-persona-id="${other}"]`);});await click(`[data-persona-id="${bot}"]`);await refresh();
 await late(async()=>{await click('#show-skills');});await click(`[data-persona-id="${bot}"]`);await refresh();
 await late(close);
 await late(async()=>{offline=true;await refresh();offline=false;await refresh();});await close();
 for(const bad of [{routine_id:sibling.id},{routine_revision:routine.revision-1},{persona_id:other}]){mismatch=bad;await click(toggle);await wait(`document.querySelector('${panel}')?.textContent.includes('Invalid or mismatched')`);assert.doesNotMatch(await text(),/Observed/);await close();}mismatch=null;
 await late(async()=>{state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:'2099-01-01T00:00:00Z',max_runs:3,admitted_runs:0,max_task_seconds:60};await refresh();});
 const alphaReads=reads.length;assert.equal(await evaluate(`document.querySelectorAll('${toggle}').length`),0);await refresh();await browser('reload');await wait('document.querySelector("#connection").textContent==="Connected"');assert.equal(reads.length,alphaReads);assert.equal(await evaluate(`document.querySelectorAll('${toggle}').length`),0);
 assert.deepEqual(writes,[]);assert.deepEqual(violations,[]);
 console.log('PASS: exact on-demand preflight GET; asymmetric blockers/execution enabled and permitted/execution disabled; paused and event-triggered; exact revision/UTC/timezone/policy; escaped text; Run now unchanged; independent history; zero writes/polling/alpha reads; error/offline/stale/ownership/deletion/persona/navigation/hide/late-response fences; mismatched ID/revision/owner rejection; desktop and 390px Chromium.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
