#!/usr/bin/env node
// Chromium against an HTTP fixture; no accounts or live skill mutations.
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {promisify} from 'node:util';

const session=`skill-history-${randomUUID().slice(0,6)}`,bot=randomUUID(),skillId=randomUUID();
const body=(name,description)=>({name,description,when_to_use:'Before travel',inputs_access:['Owner itinerary'],steps:['Read itinerary'],decision_rules:['Ask if unclear'],validation:['Check dates'],output:'Checklist',failure_handling:['Report gaps'],approval_boundaries:['Never submit forms'],contains_private_facts:false});
const skill={id:skillId,kind:'skill',revision:9,body:body('Travel checklist','Current approved procedure.')};
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Travel',archived:false}},skill],runs:[],skill_proposals:[],skill_enablements:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const pages=new Map([[null,{skill_id:skillId,current_revision:9,revisions:[{revision:8,body:body('Travel checklist','Retained revision eight.'),created_at:'2026-08-08T08:00:00.000Z'},{revision:6,body:body('Travel checklist','Retained revision six; revision seven is not retained.'),created_at:'2026-06-06T06:00:00.000Z'}],next_cursor:6}],[6,{skill_id:skillId,current_revision:9,revisions:[{revision:3,body:body('Travel checklist','Oldest retained revision.'),created_at:'2026-03-03T03:00:00.000Z'}],next_cursor:null}]]);
pages.get(null).revisions[0].body.name='Earlier travel procedure';
const requests=[],commands=[],receipts=new Map();let offline=false,historyError=false,delayHistory=false,releaseHistory;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const click=selector=>browser('click',selector);
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const settle=()=>new Promise(resolve=>setTimeout(resolve,250));
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture'),json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};requests.push(`${req.method} ${url.pathname}${url.search}`);
 try{
  if(req.method==='POST'&&url.pathname==='/v1/commands'){
   let raw='';for await(const chunk of req)raw+=chunk;const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key,raw});
   if(receipts.has(key)){assert.equal(raw,receipts.get(key).raw);return json(receipts.get(key).result);}
   assert.equal(command.type,'skill.restore');const result={status:'applied',id:command.payload.proposal_id};receipts.set(key,{raw,result});
   state.skill_proposals.push({id:command.payload.proposal_id,skill_id:skillId,proposal_revision:1,expected_skill_revision:9,status:'pending',body:pages.get(null).revisions[0].body,provenance:{kind:'owner',source_ref:`restore:${skillId}:8`}});
   if(commands.length===1)return json({error:{message:'Synthetic reply lost; staging outcome is uncertain.'}},503);return json(result);
  }
  assert.equal(req.method,'GET');
  if(url.pathname==='/v1/state')return offline?json({error:{message:'Synthetic offline state.'}},503):json(state);
  if(url.pathname===`/v1/skills/${skillId}/revisions`){
   assert.equal(url.searchParams.get('limit'),'10');assert.deepEqual([...url.searchParams.keys()].sort(),url.searchParams.has('before')?['before','limit']:['limit']);
   if(historyError)return json({error:{message:'Synthetic retained-history failure.'}},503);
   if(delayHistory)await new Promise(resolve=>{releaseHistory=resolve;});
   return json(structuredClone(pages.get(url.searchParams.has('before')?Number(url.searchParams.get('before')):null)));
  }
  if(url.pathname.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(url.pathname.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file=portalFiles[url.pathname];if(!file){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch(error){json({error:{message:`FIXTURE_REJECTED: ${error.message}`}},400);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async name=>{await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`skill-history-${name}.png`,artifacts).pathname));};
const historyReads=()=>requests.filter(value=>value.includes(`/v1/skills/${skillId}/revisions`));
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');await click('#show-skills');await refresh();
 assert.equal(historyReads().length,0);assert.equal(commands.length,0,'catalog refresh must not read history or mutate');
 await click('.skill-card > summary');await browser('eval','document.querySelector("[data-action=skill-history]").scrollIntoView({block:"center"})');await capture('desktop');await click('[data-action="skill-history"]');await wait("document.querySelector('[data-source-revision=\"8\"]')");
 assert.deepEqual(historyReads(),[`GET /v1/skills/${skillId}/revisions?limit=10`]);assert.match((await browser('get','text','[data-skill-history]')).stdout,/gaps.*proposal.*never approves/s);
 await click('[data-source-revision="8"] > summary');await browser('eval','document.querySelector("[data-skill-history]").scrollIntoView({block:"start"})');await capture('selected');
 await click('[data-skill-history] > button:last-child');await wait("document.querySelector('[data-source-revision=\"3\"]')");assert.equal(historyReads().at(-1),`GET /v1/skills/${skillId}/revisions?before=6&limit=10`);
 await browser('set','viewport','390','844','2');await browser('eval','document.querySelector("[data-skill-history]").scrollIntoView({block:"start"})');await capture('narrow');
 await browser('set','viewport','1280','900','2');historyError=true;await browser('eval','document.querySelector("[data-action=skill-history]").click()');await wait('!document.querySelector("[data-skill-history]")');await browser('eval','document.querySelector("[data-action=skill-history]").click()');await wait("document.querySelector('[data-skill-history] [role=alert]')");await browser('eval','document.querySelector("[data-skill-history] [role=alert]").scrollIntoView({block:"center"})');await capture('error');historyError=false;
 offline=true;await refresh();const beforeOffline=historyReads().length;await click('[data-skill-history] button:last-child');await settle();assert.equal(historyReads().length,beforeOffline);offline=false;await refresh();
 // Losing connectivity while a history read is pending must discard its rows.
 await click('[data-action="skill-history"]');delayHistory=true;await click('[data-action="skill-history"]');
 for(let i=0;i<50&&!releaseHistory;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releaseHistory);
 offline=true;await refresh();releaseHistory();releaseHistory=null;await wait('Boolean(document.querySelector("[data-skill-history] [role=alert]"))');
 assert.equal(await evaluate('document.querySelectorAll("[data-source-revision]").length'),0);offline=false;delayHistory=false;await refresh();
 // A mismatched live revision is not silently adopted from the history response.
 pages.get(null).current_revision=10;await click('[data-skill-history] button:last-child');await wait('Boolean(document.querySelector("[data-skill-history] [role=alert]"))');await settle();
 assert.equal(await evaluate('document.querySelectorAll("[data-source-revision]").length'),0);pages.get(null).current_revision=9;
 // A delayed response cannot repopulate history after navigation.
 await click('[data-action="skill-history"]');delayHistory=true;await browser('eval',`document.querySelector('[data-action="skill-history"]').click()`);await wait('document.querySelector("[data-skill-history]")');for(let i=0;i<50&&!releaseHistory;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(releaseHistory,'delayed history request reached fixture');await click(`button.nav-item[aria-current="false"]`);releaseHistory();releaseHistory=null;await settle();assert.equal(await evaluate('Boolean(document.querySelector("[data-skill-history]"))'),false);delayHistory=false;
 await click('#show-skills');await refresh();if(!await evaluate("Boolean(document.querySelector('[data-source-revision=\"8\"]'))")){const hide=await evaluate('document.querySelector("[data-action=skill-history]").textContent==="Hide history"');if(hide){await browser('eval','document.querySelector("[data-action=skill-history]").click()');await wait('!document.querySelector("[data-skill-history]")');}await browser('eval','document.querySelector("[data-action=skill-history]").click()');await wait("document.querySelector('[data-source-revision=\"8\"]')");}
 await browser('eval','document.querySelector("[data-source-revision=\\"8\\"] [data-action=stage-restore]").click()');await wait('document.querySelector("#editor").open');assert.match((await browser('get','text','#editor')).stdout,/pending restore proposal only.*separate action/s);await browser('check','#editor [name=confirm]');
 assert.match((await browser('get','text','#editor')).stdout,/Earlier travel procedure/);assert.equal(await evaluate('document.querySelectorAll("#editor .skill-detail").length'),11);
 await browser('uncheck','#editor [name=confirm]');await click('#editor-form button[type=submit]');assert.equal(commands.length,0);assert.equal(await evaluate('document.querySelector("#editor-form").checkValidity()'),false);await browser('check','#editor [name=confirm]');
 await browser('eval','document.querySelector("#editor-fields").scrollTop=0');await capture('confirm');
 await browser('set','viewport','390','844','2');await browser('eval','document.querySelector("#editor-fields").scrollTop=0');await capture('confirm-narrow');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await browser('set','viewport','1280','900','2');
 await browser('set','viewport','390','844','2');
 assert.deepEqual(await evaluate('(()=>{const fields=document.querySelector("#editor-fields");fields.scrollTop=fields.scrollHeight;const a=fields.getBoundingClientRect(),b=fields.querySelector(".affirmation").getBoundingClientRect(),footer=document.querySelector("#editor .dialog-footer").getBoundingClientRect();return {scrolled:fields.scrollTop>0,affirmationVisible:b.top>=a.top&&b.bottom<=a.bottom+1,footerSeparate:footer.top>=a.bottom};})()'),{scrolled:true,affirmationVisible:true,footerSeparate:true});
 await capture('confirm-narrow-bottom');await browser('set','viewport','1280','900','2');
 offline=true;await refresh();await click('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,0);offline=false;await refresh();
 skill.deleted_at='2026-09-17T00:00:00.000Z';await refresh();await click('#editor-form button[type=submit]');assert.equal(commands.length,0);delete skill.deleted_at;await refresh();
 state.objects.find(row=>row.id===skillId).revision=10;await refresh();await click('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,0);state.objects.find(row=>row.id===skillId).revision=9;await refresh();await browser('press','Escape');
 await browser('eval','document.querySelector("[data-source-revision=\\"8\\"] [data-action=stage-restore]").click()');await browser('check','#editor [name=confirm]');await browser('eval','document.querySelector("#editor-form button[type=submit]").click()');await wait('!document.querySelector("#editor-error").hidden');await wait('!document.querySelector("#editor-form button[type=submit]").disabled');assert.equal(commands.length,1);await browser('eval','document.querySelector("#editor-form button[type=submit]").click()');await wait('!document.querySelector("#editor").open');assert.equal(commands.length,2);assert.equal(commands[0].key,commands[1].key);assert.equal(commands[0].raw,commands[1].raw);assert.deepEqual(commands[0].command,{schema_version:1,type:'skill.restore',payload:{proposal_id:commands[0].command.payload.proposal_id,skill_id:skillId,expected_skill_revision:9,source_revision:8}});assert.match(commands[0].command.payload.proposal_id,/^[0-9a-f-]{36}$/);assert.equal(state.skill_proposals[0].status,'pending');
 state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:new Date(Date.now()+60000).toISOString(),max_runs:1,admitted_runs:0,max_task_seconds:60};const alphaReads=historyReads().length,alphaCommands=commands.length;await refresh();await click('#show-skills');await refresh();assert.equal(await evaluate('Boolean(document.querySelector("[data-action=skill-history]"))'),false);assert.equal(historyReads().length,alphaReads);assert.equal(commands.length,alphaCommands);
 console.log(`PASS: exact paged history URLs/envelopes, gaps/preview, offline/error/retry, stale/navigation/late-response fences, pending-only restore, same-key uncertain retry, and owner-alpha zero history reads/mutations (${historyReads().length} reads, ${commands.length} synthetic mutation requests).`);
 console.log('Screenshots: skill-history-{desktop,selected,narrow,error,confirm,confirm-narrow}.png at DPR 2. Chromium HTTP fixture only; retained rows are synthetic.');
}finally{releaseHistory?.();await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
