#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`roster-${randomUUID().slice(0,8)}`,a=randomUUID(),b=randomUUID(),c=randomUUID();
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const click=name=>browser('find','role','button','click','--name',name,'--exact');
const state={objects:[{id:a,kind:'persona',body:{name:'Alpha'}},{id:b,kind:'persona',body:{name:'Beta'}},{id:c,kind:'persona',body:{name:'Gamma'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:3},roster:{revision:0,sections:[],hidden_persona_ids:[]},roster_activity:{observed_at:new Date().toISOString(),personas:[{persona_id:b,unfinished:3,active:0,waiting:2,recovery:1}]}};
const original=JSON.stringify(state.objects),commands=[];let fail=false;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/commands'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw Error('limit');}const command=JSON.parse(raw);commands.push(command);assert.equal(command.type,'roster.set');
   const p=command.payload;if(p.expected_revision!==state.roster.revision)return json({status:'rejected',error:{message:'Reload the roster before saving this edit.'}});
   state.roster={revision:p.expected_revision+1,sections:p.sections,hidden_persona_ids:p.hidden_persona_ids};return json({id:randomUUID(),status:'applied'});
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state'){if(fail){res.writeHead(503);res.end('{}');return;}state.roster_activity.observed_at=new Date().toISOString();return json(state);}
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const wait=expression=>browser('wait','--fn',expression),evaluate=async expression=>JSON.parse((await browser('eval',expression)).stdout);
const clickSelector=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const save=async()=>{await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor").open');};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');
 await browser('fill','#roster-search','beTA');assert.equal(await evaluate('document.querySelectorAll("#bots .nav-item").length'),1);assert.equal(commands.length,0);await browser('fill','#roster-search','');
 await click('Organize');await click('Add section');await browser('fill','[name^="section-"]','Trips <safe>');
 const section=await evaluate('document.querySelector("[name^=section-]").name.slice(8)');
 await browser('select','[aria-label="Section for Beta"]',section);await browser('select','[aria-label="Section for Alpha"]',section);await click('Move Alpha up');await browser('find','label','Hide Beta','check');
 await browser('screenshot',decodeURIComponent(new URL('portal-roster-editor.png',artifacts).pathname));await save();
 assert.deepEqual(state.roster.sections[0].persona_ids,[a,b]);assert.deepEqual(state.roster.hidden_persona_ids,[b]);assert.equal(JSON.stringify(state.objects),original);
 await wait('document.querySelector("#hidden-bots-summary").textContent.includes("3 waiting/recovery")');await browser('click','#hidden-bots-summary');
 assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(`#bots [data-persona-id="${b}"]`)}).length`),0);
 assert.equal(await evaluate('document.querySelectorAll("#hidden-bots-list .nav-item").length'),1);
 await browser('screenshot',decodeURIComponent(new URL('portal-roster-desktop.png',artifacts).pathname));
 await browser('click','.roster-section-toggle');await wait('document.querySelector(".roster-section-toggle").getAttribute("aria-expanded")==="false"');
 await browser('reload');await wait('document.querySelector(".roster-section-toggle")?.getAttribute("aria-expanded")==="false"');assert.equal(state.roster.sections[0].collapsed,true);
 const count=commands.length;await browser('fill','#roster-search','alpha');assert.equal(await evaluate('document.querySelectorAll("#bots .nav-item").length'),1);assert.equal(commands.length,count);await browser('fill','#roster-search','');
 await browser('set','viewport','390','844','2');await browser('click','#hidden-bots-summary');await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await browser('screenshot',decodeURIComponent(new URL('portal-roster-narrow.png',artifacts).pathname));
 await clickSelector(`#hidden-bots-list [data-persona-id="${b}"]`);await wait('document.querySelector("#conversation-name").textContent==="Beta"');
 await browser('screenshot',decodeURIComponent(new URL('portal-roster-hidden-narrow.png',artifacts).pathname));
 await browser('set','viewport','1280','900','2');await click('Organize');state.roster.revision++;await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');assert.equal(await evaluate('document.querySelector("#editor").open'),true);
 assert.equal(await evaluate('document.querySelector(".dialog-footer").getBoundingClientRect().bottom<=document.querySelector("#editor").getBoundingClientRect().bottom'),true);
 await browser('screenshot',decodeURIComponent(new URL('portal-roster-conflict.png',artifacts).pathname));await clickSelector('#cancel-editor');await wait('!document.querySelector("#editor").open');await click('Refresh');await wait('document.querySelector("#connection").textContent==="Connected"');await click('Organize');await click('Delete section');await save();
 assert.deepEqual(state.roster.sections,[]);assert.deepEqual(state.roster.hidden_persona_ids,[b]);assert.equal(JSON.stringify(state.objects),original);await wait('document.querySelectorAll("#bots .nav-item").length===2');
 fail=true;await click('Refresh');await wait('document.querySelector("#hidden-bots-summary").textContent.includes("stale")');await browser('screenshot',decodeURIComponent(new URL('portal-roster-stale.png',artifacts).pathname));
 console.log('PASS: plain roster/search, ordered membership, literal section name, hide independent of section removal, hidden attention despite empty latest runs, collapse/reload, search without mutation, revision conflict, narrow bounds, stale observations; only explicit roster.set mutations.');
}catch(error){console.error('Fixture failure:',commands.length,'commands; editor:',(await browser('get','text','#editor-error')).stdout.trim());throw error;}
finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
