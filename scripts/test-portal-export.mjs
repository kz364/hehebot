#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const session=`export-${randomUUID().slice(0,8)}`,bot='11111111-1111-4111-8111-111111111111';
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const state={objects:[{id:bot,kind:'persona',body:{name:'Alpha'}}],runs:[],timeline:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const wire=JSON.stringify({format:'hehebot-control-export',version:1,synthetic:'PRIVATE_DOWNLOAD_CANARY_731'});
let mode='held',held,requests=0,mutations=0;
const requestModes={};
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){mutations++;res.writeHead(405);res.end();return;}
  const path=new URL(req.url,'http://fixture').pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/state')return json(state);
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  if(path==='/v1/export/control'){
   requests++;requestModes[mode]=(requestModes[mode]??0)+1;
   if(mode==='held'){held=res;return;}
   if(mode==='network'){res.destroy();return;}
   if(mode==='html'){res.writeHead(200,{'content-type':'text/html'});res.end('Synthetic sign-in page');return;}
   if(typeof mode==='number'){res.writeHead(mode,{'content-type':'application/json'});res.end('{"error":{"message":"PRIVATE_ERROR_CANARY_937"}}');return;}
   res.writeHead(200,{'content-type':'application/json'});res.end(wire);return;
  }
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url),directory=await mkdtemp(join(tmpdir(),'hehe-export-ui-'));
await mkdir(artifacts,{recursive:true});
async function capture(name){await browser('eval','document.querySelector("#export-panel").scrollIntoView();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await browser('screenshot',new URL(`portal-export-${name}.png`,artifacts).pathname);}
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','1000','2');
 await browser('wait','--fn','document.querySelector("#connection").textContent==="Connected"');
 await capture('collapsed');
 assert.equal(requests,0);assert.equal((await browser('eval','document.querySelector("#export-control").checkVisibility()')).stdout.trim(),'false');
 await browser('click','#export-panel summary');
 assert.match((await browser('get','text','#export-warning')).stdout,/unencrypted JSON/);assert.equal(requests,0);
 assert.equal((await browser('get','attr','#export-control','aria-describedby')).stdout.trim(),'export-warning');
 await capture('review');
 await browser('click','#export-control');await browser('wait','--fn','document.querySelector("#export-control").disabled');
 assert.equal(requests,1);await browser('eval','document.querySelector("#export-control").click()');assert.equal(requests,1);
 await browser('set','viewport','390','844','2');await browser('click','#show-details');await capture('waiting-narrow');
 held.writeHead(429,{'content-type':'application/json'});held.end('{}');held=null;
 await browser('wait','--fn','document.querySelector("#export-status").textContent.includes("Wait one minute")');
 assert.equal((await browser('is','enabled','#export-control')).stdout.trim(),'true');await capture('error-narrow');
 for(const [next,expected] of [[401,'Sign in again'],[413,'size limit'],[500,'Export unavailable'],['html','Unexpected export response'],['network','Connection failed']]){
  mode=next;await browser('click','#export-control');
  await browser('wait','--fn',`document.querySelector('#export-status').textContent.includes(${JSON.stringify(expected)})`);
  assert.doesNotMatch((await browser('get','text','#export-panel')).stdout,/PRIVATE_ERROR_CANARY/);
 }
 mode='success';const path=join(directory,'download.json');
 await browser('download','#export-control',path);assert.equal(await readFile(path,'utf8'),wire);
 await browser('wait','--fn','document.querySelector("#export-status").textContent.includes("Download requested")');
 assert.doesNotMatch((await browser('eval','JSON.stringify(localStorage)')).stdout,/PRIVATE_DOWNLOAD_CANARY/);
 assert.match((await browser('get','text','#export-status')).stdout,/No coordinated backup or restore has been verified/);
 assert.equal((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout.trim(),'true');
 await capture('success-narrow');
 assert.equal(mutations,0);
 for(const mode of ['held','401','413','500','html','success'])assert.equal(requestModes[mode],1);
 // Chromium may transparently retry a GET whose connection closes before headers.
 assert.ok(requestModes.network>=1);
 console.log('PASS: private export disclosure, disabled duplicate request, loading/error/retry/auth/limit/network states, actual byte-exact browser download, no localStorage content or mutation, narrow layout.');
}finally{held?.destroy();await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));await rm(directory,{recursive:true,force:true});}
