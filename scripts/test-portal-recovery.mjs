#!/usr/bin/env node
// Rendered UI contract only: synthetic HTTP receipts, no accounts or native work.
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot='11111111-1111-4111-8111-111111111111',a='33333333-3333-4333-8333-333333333333',b='44444444-4444-4444-8444-444444444444',effectId='55555555-5555-4555-8555-555555555555';
const session=`recover-${randomUUID().slice(0,8)}`,browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const effect={id:effectId,status:'outcome_unknown',classification:'mutation',action_key:'calendar:synthetic-43',request_digest:`root-child-v1:${'a'.repeat(64)}:${'b'.repeat(64)}`};
const recovery={run_id:a,attempt:3,executor_terminated:true,unresolved_operations:false,descendants_unsettled:false,retained_locks:2,stale_locks:false,effects:[effect],effects_truncated:false,can_decide_effects:true,can_recover:false};
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}}],runs:[{id:a,title:'Calendar request',persona_id:bot,role:'coordinator',status:'recovery_required',current_attempt:3},{id:b,title:'Unconfirmed sibling',persona_id:bot,role:'background',status:'recovery_required',current_attempt:1}],
 recovery:[recovery,{...recovery,run_id:b,attempt:1,executor_terminated:false,can_decide_effects:false,effects:[{...effect,id:randomUUID()}]}],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:2}};
const commands=[],events=[];
const oldA={...state.runs[1],id:'66666666-6666-4666-8666-666666666666',title:'Older retained task'},oldB={...oldA,id:'77777777-7777-4777-8777-777777777777',title:'Last recovery page'};
let emptyRecovery=false,holdRecovery=false,heldRecovery=null,failRecovery=false,offline=false,pageRecoverable=false;
const server=createServer(async(req,res)=>{
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('FIXTURE_BODY_LIMIT');}
   const command=JSON.parse(body);commands.push(command);const id=randomUUID();
   if(command.type==='effect.reconcile'){
    assert.equal(command.payload.run_id,a);assert.equal(command.payload.effect_id,effectId);recovery.effects=[];recovery.can_recover=true;
    events.push({id,sequence:1,conversation_id:bot,type:'effect.owner_reconciled',payload:{run_id:a,outcome:command.payload.outcome}});
   }else{
    assert.equal(command.type,'run.recover');assert.equal(command.payload.run_id,a);state.runs[0].status='failed';state.recovery=state.recovery.filter(row=>row.run_id!==a);
    events.push({id,sequence:2,conversation_id:bot,type:'run.owner_recovered',payload:{run_id:a,status:'failed'}});
   }
   return json({id,status:'applied'});
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state'){
   if(offline){res.writeHead(503);res.end('{}');return;}return json(state);
  }
  if(path===`/v1/conversations/${bot}/recovery`){
   if(failRecovery){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Recovery listing unavailable.'}}));return;}
   const after=new URL(req.url,'http://fixture').searchParams.get('after'),run=after?oldB:oldA;
   assert.ok(after===null||after===oldA.id);
   const page={runs:emptyRecovery?[]:[run],recovery:emptyRecovery?[]:[{...state.recovery[1],run_id:run.id,executor_terminated:pageRecoverable,can_recover:pageRecoverable,effects:[]}],next_cursor:emptyRecovery||after?null:oldA.id};
   if(holdRecovery){heldRecovery=()=>json(page);return;}return json(page);
  }
  if(path.startsWith('/v1/conversations/'))return json({events,has_more:false,pruned_through:0});
  const file=portalFiles[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch{res.writeHead(400);res.end('FIXTURE_REJECTED');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const card=id=>`.task-card[data-run-id="${id}"]`,enabled=async selector=>(await browser('is','enabled',selector)).stdout.trim()==='true';
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const rejected=async(count,message)=>{
 await browser('click','#editor-form button[type="submit"]');
 await browser('wait','--fn','!document.querySelector("#editor-error").hidden');
 assert.equal(commands.length,count);
 assert.match((await browser('get','text','#editor-error')).stdout,message);
 assert.equal((await browser('eval','document.querySelector("#editor").open')).stdout.trim(),'true');
 assert.equal((await browser('eval','document.querySelector("#editor-error").getAttribute("role")')).stdout.trim(),'"alert"');
};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await browser('wait','--fn','document.querySelector("#connection").textContent==="Connected"');
 await browser('find','role','button','click','--name','Review recovery tasks','--exact');
 await browser('wait','--fn',`document.querySelector('${card(oldA.id)}')!==null`);
 assert.equal((await browser('eval',`document.querySelector('${card(a)}')===null`)).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-page.png',artifacts).pathname));
 await click(`${card(oldA.id)} summary`);
 assert.equal(await enabled(`${card(oldA.id)} [data-action="run-recover"]`),false);
 assert.equal((await browser('eval','document.querySelector("#timeline").getBoundingClientRect().bottom<=document.querySelector("#composer").getBoundingClientRect().top')).stdout.trim(),'true');
 // Retained tasks absent from /state must recheck the current recovery page.
 pageRecoverable=true;await refresh();await click(`${card(oldA.id)} [data-action="run-recover"]`);
 await browser('check','#editor input[type="checkbox"]');
 pageRecoverable=false;await refresh();await rejected(0,/no longer eligible/);
 // agent-browser's `press Escape` wedges its daemon after a refresh re-renders the opener.
 await click('#close-editor');await browser('wait','--fn','!document.querySelector("#editor").open');
 await browser('find','role','button','click','--name','Next recovery page','--exact');
 await browser('wait','--fn',`document.querySelector('${card(oldB.id)}')!==null`);
 assert.equal((await browser('eval',`document.querySelector('${card(oldA.id)}')===null`)).stdout.trim(),'true');
 await browser('set','viewport','390','844','2');await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-page-narrow.png',artifacts).pathname));
 await browser('find','role','button','click','--name','Previous recovery page','--exact');
 await browser('wait','--fn',`document.querySelector('${card(oldA.id)}')!==null`);
 emptyRecovery=true;await browser('find','role','button','click','--name','First recovery page','--exact');
 await browser('wait','--fn','document.querySelector("#timeline").textContent.includes("No recovery tasks on this page")');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-empty-narrow.png',artifacts).pathname));
 await browser('find','role','button','click','--name','Back to messages','--exact');
 emptyRecovery=false;holdRecovery=true;
 await browser('find','role','button','click','--name','Review recovery tasks','--exact');
 await browser('wait','--fn','document.querySelector("#timeline").textContent.includes("Loading recovery tasks")');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-loading-narrow.png',artifacts).pathname));
 await browser('find','role','button','click','--name','Back to messages','--exact');
 holdRecovery=false;assert.ok(heldRecovery);heldRecovery();
 await browser('wait','--fn',`document.querySelector('${card(a)}')!==null`);
 assert.equal((await browser('eval',`document.querySelector('${card(oldA.id)}')===null`)).stdout.trim(),'true');
 failRecovery=true;await browser('find','role','button','click','--name','Review recovery tasks','--exact');
 await browser('wait','--fn','document.querySelector("#error").textContent==="Recovery listing unavailable."');
 assert.equal((await browser('eval',`document.querySelector('${card(oldA.id)}')===null`)).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-error-narrow.png',artifacts).pathname));
 assert.equal(commands.length,0);failRecovery=false;
 await browser('find','role','button','click','--name','Review recovery tasks','--exact');
 await browser('wait','--fn',`document.querySelector('${card(oldA.id)}')!==null`);
 await browser('find','role','button','click','--name','Back to messages','--exact');
 await browser('set','viewport','1280','900','2');
 await click(`${card(a)} summary`);await click(`${card(b)} summary`);
 assert.equal(await enabled(`${card(a)} [data-action="effect-reconcile"]`),true);
 assert.equal(await enabled(`${card(a)} [data-action="run-recover"]`),false);
 assert.equal(await enabled(`${card(b)} [data-action="effect-reconcile"]`),false);
 assert.equal(await enabled(`${card(b)} [data-action="run-recover"]`),false);
 await click(`${card(a)} [data-action="effect-reconcile"]`);
 assert.match((await browser('get','text','#editor')).stdout,/not provider-verified evidence/);
 await browser('click','#editor-form button[type="submit"]');assert.equal(commands.length,0);
 await browser('select','[name="outcome"]','failed');await browser('fill','[name="evidence_ref"]','manual-check:103');
 await browser('click','#editor-form button[type="submit"]');assert.equal(commands.length,0);
 await browser('check','#editor input[type="checkbox"]');
 // A disconnected editor retains private input, but cannot send its old decision.
 offline=true;await refresh();
 assert.equal(await enabled(`${card(a)} [data-action="effect-reconcile"]`),false);
 await rejected(0,/status is stale/);
 assert.equal((await browser('get','value','[name="evidence_ref"]')).stdout.trim(),'manual-check:103');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-offline-editor.png',artifacts).pathname));
 offline=false;await refresh();assert.equal(commands.length,0);
 // Same effect ID with a different digest must not reuse the reviewed decision.
 const digest=effect.request_digest;effect.request_digest=`root-child-v1:${'c'.repeat(64)}:${'d'.repeat(64)}`;await refresh();
 await rejected(0,/effect or its recovery authority changed/);
 effect.request_digest=digest;recovery.can_decide_effects=false;await refresh();
 await rejected(0,/effect or its recovery authority changed/);
 recovery.can_decide_effects=true;effect.status='confirmed';await refresh();
 await rejected(0,/effect or its recovery authority changed/);
 effect.status='outcome_unknown';await refresh();
 // Escape cancels without mutation; keyboard reopens the exact task's control.
 await browser('press','Escape');
 await browser('focus',`${card(a)} [data-action="effect-reconcile"]`);await browser('press','Enter');
 await browser('wait','--fn','document.querySelector("#editor").open');
 assert.match((await browser('get','text','#editor')).stdout,new RegExp(`Task ${a} · attempt 3`));
 await browser('select','[name="outcome"]','failed');await browser('fill','[name="evidence_ref"]','manual-check:103');
 await browser('check','#editor input[type="checkbox"]');
 await browser('click','[name="evidence_ref"]');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-decision.png',artifacts).pathname));
 await browser('click','#editor-form button[type="submit"]');await browser('wait','--fn','!document.querySelector("#editor").open');
 assert.deepEqual(commands[0],{schema_version:1,type:'effect.reconcile',payload:{run_id:a,expected_attempt:3,effect_id:effectId,expected_request_digest:effect.request_digest,outcome:'failed',evidence_ref:'manual-check:103'}});
 await browser('wait','--fn',`document.querySelector('${card(a)} [data-action="run-recover"]')?.disabled===false`);
 assert.equal(await enabled(`${card(a)} [data-action="run-recover"]`),true);
 assert.equal(await enabled(`${card(b)} [data-action="run-recover"]`),false);
 await click(`${card(b)} summary`);
 await browser('set','viewport','390','844','2');await browser('eval',`document.querySelector('${card(a)}').scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 assert.equal((await browser('eval','document.querySelector("#timeline").getBoundingClientRect().bottom<=document.querySelector("#composer").getBoundingClientRect().top')).stdout.trim(),'true');
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-ready-narrow.png',artifacts).pathname));
 await click(`${card(b)} summary`);await browser('eval',`document.querySelector('${card(b)}').scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-unconfirmed-narrow.png',artifacts).pathname));
 await click(`${card(a)} [data-action="run-recover"]`);
 assert.match((await browser('get','text','#editor')).stdout,/never successful/);
 await browser('click','#editor-form button[type="submit"]');assert.equal(commands.length,1);
 await browser('check','#editor input[type="checkbox"]');
 offline=true;await refresh();await rejected(1,/status is stale/);
 assert.equal(await enabled(`${card(a)} [data-action="run-recover"]`),false);
 offline=false;await refresh();assert.equal(commands.length,1);
 state.runs[0].current_attempt=4;recovery.attempt=4;await refresh();await rejected(1,/task attempt changed/);
 state.runs[0].current_attempt=3;recovery.attempt=3;recovery.can_recover=false;await refresh();
 await rejected(1,/no longer eligible/);
 await browser('screenshot',decodeURIComponent(new URL('portal-recovery-stale-closure-narrow.png',artifacts).pathname));
 recovery.can_recover=true;await refresh();
 await browser('click','#editor-form button[type="submit"]');
 await browser('wait','--fn','document.querySelector("#timeline").textContent.includes("Recovery closed as failed")');
 assert.deepEqual(commands[1],{schema_version:1,type:'run.recover',payload:{run_id:a,expected_attempt:3,release_resources:true}});
 assert.equal(commands.length,2);assert.equal(await enabled(`${card(b)} [data-action="run-recover"]`),false);
 console.log('PASS: independent recovery pagination, empty/error/late-response states and zero navigation mutations; offline editors and reconnect without replay; changed digest/status/authority/attempt blocked before POST; keyboard Escape/Enter; exact effect decision and separate recovery; required consent; unconfirmed sibling blocked; execution disabled; narrow layout; two synthetic commands.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
