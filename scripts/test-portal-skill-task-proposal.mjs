#!/usr/bin/env node
// Chromium against synthetic HTTP only. No task execution, inference or live skill writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`taskskill-${randomUUID().slice(0,8)}`,a=randomUUID(),b=randomUUID(),routineId=randomUUID();
const taskA={id:randomUUID(),persona_id:a,routine_id:routineId,current_attempt:3,role:'background',status:'running',title:'PRIVATE_TITLE_A',input:'PRIVATE_INPUT_A',output:'PRIVATE_OUTPUT_A',checkpoint_json:'PRIVATE_CHECKPOINT_A',context_json:'PRIVATE_MEMORY_A'};
const taskB={id:randomUUID(),persona_id:b,current_attempt:7,role:'background',status:'failed',title:'PRIVATE_TITLE_B',error_code:'SYNTHETIC_FAILURE'};
const unclaimed={id:randomUUID(),persona_id:a,current_attempt:0,role:'background',status:'queued',title:'Unclaimed'};
const skill={id:randomUUID(),kind:'skill',revision:2,body:{name:'Existing skill'}};
const state={objects:[{id:a,kind:'persona',revision:1,body:{name:'Travel'}},{id:b,kind:'persona',revision:5,body:{name:'Finance'}},{id:routineId,kind:'routine',revision:1,body:{persona_id:a,name:'Retained routine',instructions:'Synthetic routine',enabled:false,schedule:null}},skill],runs:[taskA,taskB,unclaimed],skill_proposals:[],skill_enablements:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:1,blocked_runs:0}};
const body={name:'Reusable review',description:'Compare supplied totals',when_to_use:'When explicitly asked',inputs_access:['Supplied numbers'],steps:['Recompute subtotal','Check sum'],decision_rules:['Ask about missing values'],validation:['Check units'],output:'Explained comparison',failure_handling:['Report missing data'],approval_boundaries:['Never submit'],contains_private_facts:false};
const references=[{name:'method.md',text:'  Generic notes\nLiteral \\n 😀 <b>not markup</b>  '}];
const commands=[],requests=[],failures=[],receipts=new Map();let offline=false,lose=false,rejectSource=false;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'})`);await browser('click',selector);};
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const set=(selector,value)=>browser('eval',`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
const submit=()=>browser('eval','document.querySelector("#editor-form button[type=submit]").click()');
const close=()=>browser('press','Escape');
const affirm=()=>browser('eval','document.querySelector("#editor [name=affirm]").checked=true');
const fill=async()=>{for(const [key,value] of Object.entries(body)){if(key==='contains_private_facts')continue;await set(`#editor [name=${key}]`,Array.isArray(value)?value.join('\n'):value);}};
const open=async task=>{await wait(`!!document.querySelector('#timeline [data-run-id="${task.id}"] [data-action=skill-from-task]')`);await browser('eval',`document.querySelector('#timeline [data-run-id="${task.id}"]').open=true`);await click(`#timeline [data-run-id="${task.id}"] [data-action=skill-from-task]`);await wait('document.querySelector("#editor").open');};
const localReject=async pattern=>{const count=commands.length;await submit();await wait('!document.querySelector("#editor-form button[type=submit]").disabled');assert.equal(commands.length,count);if(pattern)assert.match(await evaluate('document.querySelector("#editor-error").textContent'),pattern);};
const choose=async id=>{await browser('eval',`document.querySelector('[data-persona-id="${id}"]').click()`);await refresh();};
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'http://fixture');requests.push(`${req.method} ${req.url}`);
  if(req.method==='POST'&&url.pathname==='/v1/commands'){
   req.setEncoding('utf8');
   let raw='';for await(const chunk of req)raw+=chunk;const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key,raw});
   assert.equal(command.type,'skill.propose_from_task');assert.deepEqual(Object.keys(command.payload).sort(),['body','expected_attempt','expected_skill_revision','proposal_id','skill_id','source_run_id']);assert.doesNotMatch(raw,/PRIVATE_/);
   if(receipts.has(key)){assert.equal(raw,receipts.get(key).raw);return json(receipts.get(key).response);}
   if(rejectSource)return json({status:'rejected',error:{message:'Source attempt no longer retained.'}});
   const response={status:'applied',id:command.payload.proposal_id};receipts.set(key,{raw,response});state.skill_proposals.push({id:command.payload.proposal_id,skill_id:command.payload.skill_id,proposal_revision:1,expected_skill_revision:0,status:'pending',body:structuredClone(command.payload.body),provenance:{kind:'task',source_ref:`task:${command.payload.source_run_id}/${command.payload.expected_attempt}`}});
   if(lose){lose=false;return json({error:{message:'Synthetic lost reply; outcome uncertain'}},503);}return json(response);
  }
  assert.equal(req.method,'GET');
  if(url.pathname==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  const page=runs=>({observed_at:'2026-09-17T00:00:00Z',counts:{total:runs.length,waiting:0,recovery:0},runs,output_previews:[],steering:[],recovery:[],next_cursor:null});
  if(url.pathname===`/v1/routines/${routineId}/runs`){assert.equal(url.search,'?limit=10');return json(page([taskA]));}
  if(url.pathname.endsWith('/tasks'))return json(page(state.runs.filter(r=>url.pathname.includes(r.persona_id)&&!['completed','failed','cancelled'].includes(r.status))));
  if(url.pathname.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[url.pathname];if(!file){assert.equal(url.pathname,'/favicon.ico');res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){failures.push(error.message);json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async(name,selector='#editor-fields')=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`skill-task-proposal-${name}.png`,artifacts).pathname));};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');
 assert.equal(await evaluate('document.querySelectorAll("#timeline [data-action=skill-from-task]").length'),1);assert.equal(await evaluate(`!!document.querySelector('[data-run-id="${unclaimed.id}"] [data-action=skill-from-task]')`),false);
 // Read-only routine history remains action-free.
 await click('[data-action=routine-history]');await wait('!!document.querySelector(".routine-history .task-card")');assert.equal(await evaluate('document.querySelectorAll(".routine-history [data-action=skill-from-task]").length'),0);await click('[data-action=routine-history]');
 await browser('eval',`document.querySelector('#timeline [data-run-id="${taskA.id}"]').open=true`);await capture('entry-desktop',`#timeline [data-run-id="${taskA.id}"]`);
 const custody=JSON.stringify(state.runs);await open(taskA);assert.equal(commands.length,0);
 assert.equal(await evaluate('Array.from(document.querySelectorAll("#editor input:not([type=checkbox]),#editor textarea")).every(n=>n.value==="")'),true);assert.doesNotMatch(await evaluate('document.querySelector("#editor").textContent'),/PRIVATE_/);assert.match(await evaluate('document.querySelector("#editor").textContent'),new RegExp(`${a}.*${taskA.id}.*Attempt 3`));
 await capture('desktop');await browser('set','viewport','390','844','2');await capture('narrow');assert.equal(await evaluate('(()=>{const fields=document.querySelector("#editor-fields"),footer=document.querySelector("#editor .dialog-footer");return document.documentElement.scrollWidth<=innerWidth&&fields.scrollHeight>fields.clientHeight&&footer.getBoundingClientRect().top>=fields.getBoundingClientRect().bottom})()'),true);await browser('set','viewport','1280','900','2');
 await fill();await localReject();await affirm();await set('#editor [name=target]',skill.id);await localReject(/target changed/);await set('#editor [name=target]','new');
 await click('[data-action=add-reference]');await set('#editor [name=reference_name]',references[0].name);await set('#editor [name=reference_text]',references[0].text);
 await browser('set','viewport','390','844','2');await capture('references-narrow','.reference-editor-row');await browser('set','viewport','1280','900','2');
 lose=true;await submit();await wait('!document.querySelector("#editor-error").hidden');await wait('!document.querySelector("#editor-form button[type=submit]").disabled');assert.equal(commands.length,1);const first=commands[0];
 assert.deepEqual(first.command,{schema_version:1,type:'skill.propose_from_task',payload:{proposal_id:first.command.payload.proposal_id,skill_id:first.command.payload.skill_id,expected_skill_revision:0,source_run_id:taskA.id,expected_attempt:3,body:{...body,references}}});assert.match(first.key,/^[0-9a-f-]{36}$/);assert.match(first.command.payload.skill_id,/^[0-9a-f-]{36}$/);assert.match(first.command.payload.proposal_id,/^[0-9a-f-]{36}$/);
 await set('#editor [name=reference_text]','Changed after uncertain response');await localReject(/already submitted/);await set('#editor [name=reference_text]',references[0].text);await submit();await wait('!document.querySelector("#editor").open');assert.deepEqual(commands[1],first);assert.equal(state.skill_proposals.length,1);assert.equal(state.skill_proposals[0].status,'pending');assert.equal(JSON.stringify(state.runs),custody);
 // Failed task B is a separate source, not successful execution evidence.
 await choose(b);await open(taskB);await fill();await affirm();await submit();await wait('!document.querySelector("#editor").open');assert.equal(commands.at(-1).command.payload.source_run_id,taskB.id);assert.equal(commands.at(-1).command.payload.expected_attempt,7);assert.equal(Object.hasOwn(commands.at(-1).command.payload.body,'references'),false);assert.equal(JSON.stringify(state.runs),custody);
 await choose(a);
 for(const change of ['attempt','missing','title','status','owner','persona-revision','offline','skills-navigation','persona-away-back']){
  await open(taskA);await fill();await affirm();const saved=structuredClone(taskA),persona=state.objects[0].revision;
  if(change==='attempt')taskA.current_attempt=4;if(change==='missing')state.runs=state.runs.filter(r=>r.id!==taskA.id);if(change==='title')taskA.title='Changed visible task';if(change==='status')taskA.status='finishing';if(change==='owner')taskA.persona_id=b;if(change==='persona-revision')state.objects[0].revision++;if(change==='offline')offline=true;
  if(change==='skills-navigation')await browser('eval','document.querySelector("#show-skills").click()');if(change==='persona-away-back'){await choose(b);await choose(a);}await refresh();await localReject(/Source task/);
  if(change==='offline')assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-action=skill-from-task]")).every(n=>n.disabled)'),true);
  await close();Object.assign(taskA,saved);state.objects[0].revision=persona;state.runs=[taskA,taskB,unclaimed];offline=false;await choose(a);
 }
 // A task-page source is fenced to that page/navigation identity too.
 await click('#task-strip-summary');await click(`.task-strip-row[data-task-id="${taskA.id}"]`);await wait(`document.querySelector('#timeline [data-run-id="${taskA.id}"]')?.open===true`);await open(taskA);await fill();await affirm();await browser('eval','document.querySelector("#show-skills").click()');await refresh();await localReject(/Source task/);await close();await choose(a);
 // The public projection cannot establish server retention; show its rejection.
 await open(taskA);await fill();await affirm();rejectSource=true;await submit();await wait('!document.querySelector("#editor-error").hidden');assert.match(await evaluate('document.querySelector("#editor-error").textContent'),/no longer retained/);await capture('retention-error');await close();rejectSource=false;
 // Browser-offline detection works even before the next snapshot poll.
 await browser('eval','Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false});window.dispatchEvent(new Event("offline"))');assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-action=skill-from-task]")).every(n=>n.disabled)'),true);await browser('eval','delete navigator.onLine');await refresh();
 await open(taskA);await fill();await affirm();state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:a,expires_at:'2099-01-01T00:00:00Z',max_runs:2,admitted_runs:0,max_task_seconds:60};await refresh();assert.equal(await evaluate('document.querySelectorAll("[data-action=skill-from-task]").length'),0);await localReject(/owner-alpha/);await close();
 const count=commands.length;await refresh();assert.equal(commands.length,count);assert.equal(JSON.stringify(state.runs),custody);assert.deepEqual(failures,[]);
 console.log('PASS: exact owner task/attempt payload; blank procedural draft with no private canary copying; running A and failed B independent; references preserved; required affirmation/exact target; same-key uncertain retry and edited-reference fence; unchanged tasks; missing/changed attempt/title/status/owner/persona/navigation/offline/alpha rejection; current-task-page identity; action-free routine history; server retention rejection; no automatic writes; 2x desktop/390px Chromium.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
