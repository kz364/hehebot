#!/usr/bin/env node
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`profile-${randomUUID().slice(0,8)}`,bot=randomUUID(),policy=randomUUID();
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const click=name=>browser('find','role','button','click','--name',name,'--exact'),wait=fn=>browser('wait','--fn',fn),value=async name=>JSON.parse((await browser('eval',`document.querySelector('[name="${name}"]').value`)).stdout);
const source={id:bot,kind:'persona',revision:2,body:{name:'Travel',role:'Researcher',instructions:'Synthetic source instruction <literal>',tool_policy_ids:[policy],archived:false}};
const state={objects:[source],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}},commands=[],receipts=new Map();let loseAck=false;
const original=JSON.stringify(source);
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/commands'){
   let raw='';for await(const chunk of req)raw+=chunk;const command=JSON.parse(raw),key=req.headers['idempotency-key'];assert.equal(command.type,'persona.put');commands.push({key,command});
   if(receipts.has(key)){assert.equal(receipts.get(key).raw,raw);return json(receipts.get(key).receipt);}
   const receipt={id:randomUUID(),status:'applied'},p=command.payload;receipts.set(key,{raw,receipt});state.objects.push({id:p.id,kind:'persona',revision:1,body:p});
   if(loseAck){loseAck=false;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"Save not confirmed. Retry unchanged or review the receipt."}}');return;}return json(receipt);
  }
  assert.equal(req.method,'GET');if(path==='/v1/state')return json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file=portalFiles[path];if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const clickSelector=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const save=async()=>{await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor").open');};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');await click('Add bot');
 assert.equal(await value('role'),'');assert.equal(await value('instructions'),'');await browser('fill','[name=name]','Minimal');await browser('fill','[name=instructions]','Use only public information.');
 await browser('screenshot',decodeURIComponent(new URL('portal-profile-minimal.png',artifacts).pathname));await save();assert.deepEqual(commands[0].command.payload.tool_policy_ids,[]);assert.notEqual(commands[0].command.payload.id,bot);assert.equal(commands[0].command.payload.role,'');
 await click('Instructions');await click('Duplicate as new bot');await wait('document.querySelector("#editor-title").textContent==="Duplicate bot"');assert.equal(await value('role'),'');assert.equal(await value('instructions'),'');assert.equal(commands.length,1);
 await clickSelector('#editor input[type=checkbox]');assert.equal(await value('role'),'Researcher');assert.equal(await value('instructions'),source.body.instructions);
 await browser('set','viewport','390','844','2');await browser('eval','document.querySelector("#editor .review-notice").scrollIntoView({behavior:"instant",block:"start"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(JSON.parse((await browser('eval','document.documentElement.scrollWidth<=innerWidth')).stdout),true);await browser('screenshot',decodeURIComponent(new URL('portal-profile-duplicate-narrow.png',artifacts).pathname));
 loseAck=true;await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');await save();
 assert.equal(commands.length,3);assert.equal(receipts.size,2);assert.deepEqual(commands[1],commands[2]);
 const duplicate=commands[1].command.payload;assert.notEqual(duplicate.id,bot);assert.notEqual(duplicate.id,commands[0].command.payload.id);assert.equal(duplicate.expected_revision,0);assert.equal(duplicate.archived,false);assert.deepEqual(duplicate.tool_policy_ids,[]);
 assert.deepEqual(Object.keys(duplicate).sort(),['id','expected_revision','name','role','instructions','tool_policy_ids','archived'].sort());assert.equal(JSON.stringify(source),original);
 await browser('reload');await wait('document.querySelectorAll("#bots .nav-item").length===3');
 console.log('PASS: minimal creation, explicit reviewed instruction copy, new identity without authority fields, source unchanged, narrow form, exact same-key/body retry after lost acknowledgment, reload; two profile creations and no model/wake endpoints.');
}finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
