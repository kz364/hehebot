#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`monitor-${randomUUID().slice(0,8)}`,bot='11111111-1111-4111-8111-111111111111';
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const monitoring={scope:'control-plane-only',observed_at:'2026-09-14T01:00:00.000Z',lease:{expected_running:false,heartbeat_age_seconds:null},queue:{count:0,oldest_request_age_seconds:null},operations:[],effects:[],locks:0,schedules:{overdue:0,lag_seconds:0},backup:{status:'unverified',last_verified_at:null},alerts:[]};
const state={monitoring,objects:[{id:bot,kind:'persona',body:{name:'Alpha'}}],runs:[],timeline:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
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
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','1000','2');
 await browser('wait','--fn','document.querySelector("#connection").textContent==="Connected"');
 assert.match((await browser('get','text','#monitoring-panel')).stdout,/Zero recorded activity does not prove native settlement or safe sleep/);
 assert.match((await browser('get','text','#monitoring-stats')).stdout,/Not verified/);
 assert.equal(Number((await browser('get','count','#monitoring-alerts p')).stdout.trim()),0);
 await browser('eval','document.querySelector("#monitoring-panel").scrollIntoView()');await browser('screenshot',decodeURIComponent(new URL('portal-monitoring-empty.png',artifacts).pathname));
 monitoring.lease={expected_running:true,heartbeat_age_seconds:46};monitoring.queue={count:3,oldest_request_age_seconds:121};monitoring.operations=[{kind:'tool',status:'active',count:2},{kind:'child',status:'unknown',count:1}];monitoring.effects=[{status:'outcome_unknown',count:2}];monitoring.locks=1;
 state.summary={phase:'READY',execution_enabled:true,queued_runs:3,blocked_runs:1};
 monitoring.alerts=[{code:'HEARTBEAT_STALE',severity:'warning'},{code:'CANCEL_UNCONFIRMED',severity:'error',count:1},{code:'OUTCOME_UNKNOWN',severity:'error',count:2},{code:'BACKUP_UNVERIFIED',severity:'warning'}];
 await browser('click','#refresh');await browser('wait','--fn','document.querySelector("#monitoring-alerts").textContent.includes("External outcomes are unknown")');
 const stats=(await browser('eval','Object.fromEntries(Array.from(document.querySelectorAll("#monitoring-stats div"),row=>[row.querySelector("dt").textContent,row.querySelector("dd").textContent]))')).stdout;
 for(const text of ['121s','46s','Uncertain effects'])assert.ok(stats.includes(text));
 assert.match((await browser('get','text','#monitoring-operations')).stdout,/2 tool · active/);assert.match((await browser('get','text','#monitoring-operations')).stdout,/1 child · unknown/);
 assert.match((await browser('get','text','#monitoring-alerts')).stdout,/Reconcile before retrying/);
 // Unchanged polling must not recreate and repeatedly announce the alert region.
 await browser('eval','window.originalAlerts=Array.from(document.querySelector("#monitoring-alerts").children);window.renderCount=0;window.observer=new MutationObserver(()=>window.renderCount++);window.observer.observe(document.querySelector("#monitoring-stats"),{childList:true})');
 await browser('click','#refresh');await browser('wait','--fn','window.renderCount>0');
 assert.equal((await browser('eval','window.originalAlerts.every((element,index)=>element===document.querySelector("#monitoring-alerts").children[index])')).stdout.trim(),'true');
 await browser('eval','document.querySelector("#monitoring-panel").scrollIntoView()');await browser('screenshot',decodeURIComponent(new URL('portal-monitoring-alerts.png',artifacts).pathname));
 await browser('set','viewport','390','844','2');await browser('click','#show-details');await browser('eval','document.querySelector("#monitoring-panel").scrollIntoView();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');await browser('screenshot',decodeURIComponent(new URL('portal-monitoring-narrow.png',artifacts).pathname));
 assert.equal(mutations,0);console.log('PASS: empty/alert monitoring DOM, recorded tool/child counts, uncertainty and backup warnings, stable live-region nodes, narrow layout; zero mutations.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
