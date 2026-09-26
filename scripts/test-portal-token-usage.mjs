#!/usr/bin/env node
// Real Chromium, synthetic read-only API. No accounts, inference, commands or mutations.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

const session=`usage-${randomUUID().slice(0,8)}`,persona=randomUUID(),routineId=randomUUID();
const runId=randomUUID(),run={id:runId,persona_id:persona,routine_id:routineId,title:'Bounded token review',role:'background',status:'running',current_attempt:2,request_status:'applied',execution:null,run_delivery:{counts:{pending:0,delivered:0,failed:0,outcome_unknown:0},portal:null}};
const counters=(a,b,c,d,e,f)=>({inputTokens:a,cachedInputTokens:b,cacheWriteInputTokens:c,outputTokens:d,reasoningOutputTokens:e,totalTokens:f});
const valid={run_id:runId,attempt:2,version:1,usage:{total:counters(120,30,7,44,11,182),last:counters(9,0,2,3,1,15),modelContextWindow:null}};
const state={objects:[{id:persona,kind:'persona',revision:1,body:{name:'Usage bot',archived:false}},{id:routineId,kind:'routine',revision:1,body:{persona_id:persona,name:'Usage routine',instructions:'Synthetic only',enabled:true,schedule:{cron:'0 8 * * *',timezone:'Asia/Jakarta'}}}],runs:[run],token_usage_snapshots:[valid],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
let taskUsage=[valid],routineUsage=[valid],commands=0;const requests=[];
const page=usage=>({observed_at:'2026-09-17T00:00:00Z',counts:{total:1,waiting:0,recovery:0},runs:[run],next_cursor:null,steering:[],recovery:[],output_previews:[],token_usage_snapshots:usage});
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname;
 // GROK_ALIGNMENT A6: the portal always attempts a same-origin WebSocket at /v1/stream.
 // This fixture is plain HTTP with no upgrade handling, so answer with 426 and keep it
 // out of the request log the assertions below check — it is not one of the reads under test.
 if(path==='/v1/stream'){res.writeHead(426);return res.end();}
 requests.push(`${req.method} ${req.url}`);if(req.method!=='GET')commands++;const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/v1/state')return json(state);
 if(path===`/v1/conversations/${persona}/events`)return json({events:[],has_more:false,pruned_through:0});
 if(path===`/v1/conversations/${persona}/tasks`)return json(page(taskUsage));
 if(path===`/v1/conversations/${persona}/recovery`)return json({...page([]),runs:[{...run,status:'recovery_required'}]});
 if(path===`/v1/routines/${routineId}/runs`)return json(page(routineUsage));
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evalJson=async code=>JSON.parse((await browser('eval',code)).stdout),wait=code=>browser('wait','--fn',code);
const usageText=()=>evalJson('document.querySelector("#timeline .token-usage")?.textContent??""');
const refresh=async()=>{await browser('eval','document.querySelector("#refresh").onclick()');await wait('document.querySelector("#connection").textContent==="Connected"');};
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector(".task-card")');await browser('click','.task-card summary');
 let text=await usageText();assert.match(text,/Native cumulative snapshotInput tokens: 120.*Cached input tokens: 30.*Native last snapshotInput tokens: 9.*Cached input tokens: 0/s);assert.match(text,/attempt 2 · observation version 1/);assert.match(text,/Model context window: unavailable/);assert.match(text,/partial or stale.*not live.*not additive across tasks or children.*billing or settlement/s);assert.doesNotMatch(text,/\$|%/);
 // Usage-only state updates must rerender. Decreasing and all-zero observations remain exact observations.
 state.token_usage_snapshots=[{...valid,version:2,usage:{total:counters(8,1,0,2,0,10),last:counters(0,0,0,0,0,0),modelContextWindow:32768}}];await refresh();text=await usageText();assert.match(text,/Native cumulative snapshotInput tokens: 8.*Native last snapshotInput tokens: 0.*Total tokens: 0.*Model context window: 32,768/s);
 const unavailable=async rows=>{state.token_usage_snapshots=rows;await refresh();assert.match(await usageText(),/Token usage unavailable for this attempt/);};
 await unavailable([]);await unavailable([{...valid,attempt:1}]);await unavailable([{...valid,usage:{...valid.usage,total:{...valid.usage.total,inputTokens:-1}}}]);await unavailable([valid,{...valid,version:2}]);
 await browser('screenshot',decodeURIComponent(new URL('token-usage-unavailable.png',artifacts).pathname));
 // Current-task page must use only its own page snapshots, never the conflicting global state.
 state.token_usage_snapshots=[valid];taskUsage=[{...valid,version:4,usage:{total:counters(400,0,0,40,4,444),last:counters(4,0,0,1,0,5),modelContextWindow:65536}}];await refresh();await browser('click','#task-strip-summary');await browser('find','role','button','click','--name','Review task details','--exact');await wait('document.querySelector("#timeline .task-card")');await browser('click','#timeline .task-card summary');text=await usageText();assert.match(text,/Input tokens: 400/);assert.doesNotMatch(text,/Input tokens: 120/);
 // Recovery pages have no usage contract and cannot borrow global observations.
 await browser('find','role','button','click','--name','Back to messages','--exact');await browser('find','role','button','click','--name','Review recovery tasks','--exact');await wait('document.querySelector("#timeline .task-card")');await browser('click','#timeline .task-card summary');assert.match(await usageText(),/Token usage unavailable for this attempt/);
 // Routine history likewise uses only its selected page.
 await browser('find','role','button','click','--name','Back to messages','--exact');routineUsage=[{...valid,version:5,usage:{total:counters(700,6,5,4,3,718),last:counters(7,0,0,2,0,9),modelContextWindow:131072}}];await browser('click','[data-action="routine-history"]');await wait('document.querySelector(".routine-history .task-card")');await browser('click','.routine-history .task-card summary');text=await evalJson('document.querySelector(".routine-history .token-usage").textContent');assert.match(text,/Input tokens: 700/);assert.doesNotMatch(text,/Input tokens: 120/);
 await browser('eval','document.querySelector(".routine-history .token-usage").scrollIntoView({block:"center"})');assert.equal(await evalJson('devicePixelRatio'),2);assert.equal(await evalJson('document.querySelector(".routine-history .token-usage").scrollWidth<=document.querySelector(".routine-history .token-usage").clientWidth'),true);await browser('screenshot','.routine-history .token-usage',decodeURIComponent(new URL('token-usage-desktop.png',artifacts).pathname));
 await browser('set','viewport','390','844','2');await browser('click','#show-details');await browser('eval','document.querySelector(".routine-history .token-usage").scrollIntoView({block:"center"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evalJson('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".routine-history .token-usage").scrollWidth<=document.querySelector(".routine-history .token-usage").clientWidth'),true);await browser('screenshot','.routine-history .token-usage',decodeURIComponent(new URL('token-usage-narrow.png',artifacts).pathname));
 assert.equal(commands,0);assert.ok(requests.every(value=>value.startsWith('GET ')));
 assert.ok(requests.every(value=>['/','/app.js','/style.css','/import-setup.js','/favicon.ico','/v1/state',`/v1/conversations/${persona}/events`,`/v1/conversations/${persona}/tasks`,`/v1/conversations/${persona}/recovery`,`/v1/routines/${routineId}/runs`].includes(new URL(value.slice(4),'http://fixture').pathname)));
 console.log(`PASS: token usage validation, rerender, isolation, recovery fence, zero commands; ${requests.length} existing read requests.`);
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
