#!/usr/bin/env node
// Real portal DOM; synthetic HTTP receipts, never a live owner installation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot='11111111-1111-4111-8111-111111111111',routine='22222222-2222-4222-8222-222222222222',run='33333333-3333-4333-8333-333333333333';
const session=`budget-${randomUUID().slice(0,8)}`;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const budget={policy:{enabled:false,monthly_cap_cents:500,optional_routine_ids:[]},revision:0,period:'2026-09',report:null,freshness:'missing',status:'disabled',threshold:0};
const state={budget,objects:[{id:bot,kind:'persona',revision:1,body:{name:'Alpha'}},{id:routine,kind:'routine',revision:1,body:{name:'Optional report',persona_id:bot,enabled:false,schedule:{cron:'0 8 * * *',timezone:'Asia/Jakarta'}}}],runs:[],timeline:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const commands=[];
const server=createServer(async(req,res)=>{
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('FIXTURE_BODY_LIMIT');}
   const command=JSON.parse(body);commands.push(command);
   if(command.type==='budget.set'){
    assert.equal(command.payload.expected_revision,budget.revision);
    budget.policy={enabled:command.payload.enabled,monthly_cap_cents:command.payload.monthly_cap_cents,optional_routine_ids:command.payload.optional_routine_ids};budget.revision++;
    budget.status='BUDGET_UNKNOWN';
   }else assert.equal(command.type,'budget.override');
   return json({id:randomUUID(),status:'applied'});
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state')return json(state);
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){res.writeHead(400);res.end(String(error));}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const refresh=async text=>{await browser('click','#refresh');await browser('wait','--fn',`document.querySelector('#budget-summary').textContent.includes(${JSON.stringify(text)})`);};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');
 await browser('wait','--fn','document.querySelector("#connection").textContent==="Connected"');
 assert.match((await browser('get','text','#budget-summary')).stdout,/Budget suspension is off/);
 await browser('click','#edit-budget');await browser('select','[name="enabled"]','true');await browser('fill','[name="cap"]','7.19');await browser('check','[name="optional"]');
 await browser('screenshot',new URL('portal-budget-editor.png',artifacts).pathname);
 await browser('click','#editor-form button[type="submit"]');await browser('wait','--fn','!document.querySelector("#editor").open');
 assert.deepEqual(commands[0],{schema_version:1,type:'budget.set',payload:{expected_revision:0,enabled:true,monthly_cap_cents:719,optional_routine_ids:[routine]}});
 await browser('wait','--fn','document.querySelector("#budget-summary").textContent.includes("estimate unavailable or expired")');
 assert.match((await browser('get','text','#budget-summary')).stdout,/estimate unavailable or expired/);
 budget.report={period:'2026-09',projected_cents:504,observed_at:'2026-09-14T01:00:00.000Z',source_ref:'synthetic:19'};budget.freshness='fresh';budget.status='ok';budget.threshold=70;
 await refresh('Within projected cap');assert.match((await browser('get','text','#budget-summary')).stdout,/\$5.04 projected/);
 assert.match((await browser('get','text','#budget-summary [role="status"]')).stdout,/70%/);
 budget.report.projected_cents=648;budget.threshold=90;await refresh('90%');
 budget.report.projected_cents=743;budget.status='BUDGET_BLOCKED';budget.threshold=100;
 state.runs=[{id:run,persona_id:bot,routine_id:routine,role:'coordinator',status:'waiting',current_attempt:0,error_code:'BUDGET_BLOCKED'}];
 await refresh('projected cap reached');await browser('eval','document.querySelector("#budget-panel").scrollIntoView()');
 await browser('screenshot',new URL('portal-budget-blocked.png',artifacts).pathname);
 await browser('click','#budget-waits button');await browser('wait','--fn','document.querySelector("#editor").open');
 assert.match((await browser('get','text','#editor')).stdout,/only this scheduled run/);
 await browser('click','#editor-form button[type="submit"]');await browser('wait','--fn','!document.querySelector("#editor").open');
 assert.deepEqual(commands[1],{schema_version:1,type:'budget.override',payload:{run_id:run,expected_revision:1}});
 budget.freshness='stale';budget.status='BUDGET_UNKNOWN';await refresh('estimate unavailable or expired');
 assert.match((await browser('get','text','#budget-summary')).stdout,/stale/);
 assert.equal(Number((await browser('get','count','#budget-summary [role="status"]')).stdout.trim()),0);
 await browser('set','viewport','390','844','2');await browser('click','#show-details');await browser('eval','document.querySelector("#budget-panel").scrollIntoView(); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 await browser('screenshot',new URL('portal-budget-narrow.png',artifacts).pathname);
 assert.equal(commands.length,2);
 console.log('PASS: disabled/missing/fresh/blocked/stale budget DOM; exact cents, selected routines and revision-bound override; two synthetic commands; narrow layout without horizontal overflow.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
