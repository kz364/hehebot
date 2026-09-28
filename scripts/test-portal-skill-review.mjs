#!/usr/bin/env node
// Chromium against synthetic state/receipts; no accounts or live skill mutations.
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`skills-${randomUUID().slice(0,8)}`,bot=randomUUID();
const hostile='<img src=x onerror="window.skillInjected=true">';
const body={name:'Review travel checklist',description:'Check required documents.',when_to_use:'Before preparing a trip',inputs_access:['Owner-selected itinerary'],steps:['Read itinerary','Check dates'],decision_rules:['Ask when uncertain'],validation:['Verify document dates'],output:'A short checklist',failure_handling:['Report missing inputs'],approval_boundaries:['Never submit forms'],contains_private_facts:false};
const skill={id:randomUUID(),kind:'skill',revision:4,body};
const proposal={id:randomUUID(),skill_id:skill.id,proposal_revision:7,expected_skill_revision:4,status:'pending',body:{...body,name:'Review travel documents',description:`Check expiry and entry requirements. ${hostile}`,steps:['Check dates','Read itinerary','Flag gaps'],failure_handling:[]},provenance:{kind:'import',source_ref:`synthetic:${hostile}`},executable_files_changed:false};
const fresh={...structuredClone(proposal),id:randomUUID(),skill_id:randomUUID(),proposal_revision:1,expected_skill_revision:0,body:{...body,name:'New checklist'}};
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}},skill],runs:[],skill_proposals:[proposal,fresh],skill_enablements:[{skill_id:skill.id,persona_id:bot,skill_revision:4,enabled:true}],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const initial=structuredClone(state),commands=[];
let offline=false,mode='reject',receiptKey;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const refresh=()=>browser('eval','document.querySelector("#refresh").onclick()');
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const card=id=>`[data-proposal-id="${id}"]`;
const server=createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(req.method==='POST'&&path==='/v1/commands'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('Oversized command');}
   const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key});
   if(mode==='reject')return json({status:'rejected',error:{message:'Synthetic revision conflict: reload the proposal.'}});
   if(mode==='lost'){receiptKey=key;mode='apply';return json({error:{message:'Synthetic reply lost; outcome not confirmed.'}},503);}
   const row=state.skill_proposals.find(p=>p.id===command.payload.proposal_id);row.status=command.payload.decision==='approve'?'approved':'rejected';
   return json({status:'applied',id:randomUUID()});
  }
  assert.equal(req.method,'GET');
  if(path==='/v1/state')return offline?json({error:{message:'Synthetic offline state'}},503):json(state);
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file=portalFiles[path];
  if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch{json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async name=>{await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`skill-review-${name}.png`,artifacts).pathname));};
const checkReviewScroll=async()=>{
 const result=await evaluate(`(()=>{const fields=document.querySelector('#editor-fields');fields.scrollTop=fields.scrollHeight;const area=fields.getBoundingClientRect(),last=fields.querySelector('[data-skill-field="references"]').getBoundingClientRect(),footer=document.querySelector('#editor .dialog-footer').getBoundingClientRect();return {scrolls:fields.scrollTop>0,lastVisible:last.top>=area.top&&last.bottom<=area.bottom+1,footerSeparate:footer.top>=area.bottom};})()`);
 assert.deepEqual(result,{scrolls:true,lastVisible:true,footerSeparate:true});
};
const open=async(decision='approve',id=proposal.id)=>{
 if(!await evaluate(`document.querySelector('${card(id)}').open`))await click(`${card(id)} > summary`);
 await click(`${card(id)} [data-action="skill-${decision}"]`);await wait('document.querySelector("#editor").open');
};
const affirm=()=>browser('check','#editor [name="affirm"]');
const submit=async()=>{await browser('wait','--fn','!document.querySelector("#editor-form button[type=submit]").disabled');await click('#editor-form button[type="submit"]');};
// agent-browser's `press Escape` wedges its daemon (Chromium relaunches) once a refresh has
// re-rendered the editor's opener, so closes use the dialog's own button. The shared submit
// button also stays disabled until the previous save's refresh settles.
const close=async()=>{await browser('click','#close-editor');await browser('wait','--fn','!document.querySelector("#editor").open');};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');
 await wait('document.querySelector("#connection").textContent==="Connected"');await click('#show-skills');await refresh();
 await click(`${card(proposal.id)} > summary`);
 assert.equal(commands.length,0);
 const values=await evaluate(`Array.from(document.querySelectorAll('${card(proposal.id)} [data-skill-field]')).map(s=>[s.dataset.skillField,s.querySelector('h4').textContent,Array.from(s.querySelectorAll('.skill-detail')).map(d=>d.textContent)])`);
 assert.equal(values.length,11);
 for(const [key,title,parts] of values){
  const changed=['name','description','steps','failure_handling'].includes(key);
  assert.ok(title.endsWith(changed?'Changed':'Unchanged'),`${key}: change marker`);
  if(key==='references'){assert.equal(parts.length,2);for(const part of parts)assert.match(part,/Not specified \(legacy field omitted\)/);continue;}
  const text=value=>Array.isArray(value)?value.length?value.join(''):'None':value;
  assert.deepEqual(parts,[`Current approved${text(body[key])}`,`Proposed${text(proposal.body[key])}`]);
 }
 assert.equal(await evaluate('Boolean(window.skillInjected)||Boolean(document.querySelector("#timeline img"))'),false);
 await browser('eval',`document.querySelector('${card(proposal.id)} [data-skill-field="name"]').scrollIntoView({behavior:'instant',block:'start'})`);
 await capture('desktop');
 await open();assert.equal(await evaluate('document.querySelector("#editor").getAttribute("aria-labelledby")'),'editor-title');
 assert.match((await browser('get','text','#editor')).stdout,/already-enabled bots for future tasks.*already-admitted tasks/s);
 await submit();assert.equal(commands.length,0);assert.equal(await evaluate('document.querySelector("#editor-form").checkValidity()'),false);
 await browser('press','Escape');await browser('wait','--fn','!document.querySelector("#editor").open');assert.equal(await evaluate('document.querySelector("#editor").open'),false);
 console.log('PASS: eleven exact field comparisons, ordered list changes, empty-list removal, unchanged fields, hostile markup as text, staged review, required private-facts affirmation and Escape.');
 for(const decision of ['approve','reject']){
  for(const change of ['proposal revision','proposal status','skill revision','skill missing','offline']){
   Object.assign(state,structuredClone(initial));offline=false;await refresh();await open(decision);if(decision==='approve')await affirm();
   if(change==='proposal revision')state.skill_proposals[0].proposal_revision++;
   if(change==='proposal status')state.skill_proposals[0].status='rejected';
   if(change==='skill revision')state.objects[1].revision++;
   if(change==='skill missing')state.objects.pop();
   if(change==='offline')offline=true;
   await refresh();await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,0);
   assert.match((await browser('get','text','#editor-error')).stdout,/stale, changed, or offline/);
   if(change==='offline'){
    assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-action=skill-approve],[data-action=skill-reject]")).every(b=>b.disabled)'),true);
    if(decision==='approve'){
     await browser('set','viewport','390','844','2');
     await browser('eval','document.querySelector("#editor-fields").scrollTop=document.querySelector("#editor-fields").scrollHeight');
     assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#editor").scrollWidth<=document.querySelector("#editor").clientWidth'),true);
     assert.equal(await evaluate('document.querySelector("#editor-error").getAttribute("role")'),'alert');await capture('offline-narrow');
    }
    offline=false;await refresh();assert.equal(commands.length,0);
   }
   await close();
  }
 }
 console.log('PASS: approve AND reject fence changed proposal revision/status, changed/missing approved skill and offline snapshot; reconnect sends nothing.');
 Object.assign(state,structuredClone(initial));state.objects[1].revision=5;await refresh();
 assert.equal(await evaluate(`document.querySelector('${card(proposal.id)} [data-action="skill-approve"]').disabled`),true);
 assert.equal(await evaluate(`document.querySelector('${card(proposal.id)} [data-action="skill-reject"]').disabled`),false);
 Object.assign(state,structuredClone(initial));await refresh();await open('approve',fresh.id);
 assert.match((await browser('get','text','#editor')).stdout,/New skill — no prior approved version/);
 assert.equal(await evaluate('Array.from(document.querySelectorAll("#editor .skill-detail h4")).some(h=>h.textContent==="Current approved")'),false);
 await checkReviewScroll();
 await browser('eval','document.querySelector("#editor-fields").scrollTop=0');await capture('new-narrow');await close();
 await browser('set','viewport','1280','900','2');await open();
 await browser('focus','#editor [name="affirm"]');await browser('press','Space');
 assert.equal(await evaluate('document.querySelector("#editor [name=affirm]").checked'),true);
 await browser('press','Tab');assert.equal(await evaluate('document.activeElement.id'),'cancel-editor');
 await browser('press','Tab');assert.equal(await evaluate('document.activeElement.type'),'submit');await browser('press','Enter');
 await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,1);
 assert.match((await browser('get','text','#editor-error')).stdout,/Synthetic revision conflict/);
 await checkReviewScroll();
 await browser('eval','document.querySelector("#editor-fields").scrollTop=0');await capture('error-desktop');await close();
 mode='lost';await open();await affirm();await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,2);
 await submit();await wait('!document.querySelector("#editor").open');assert.equal(commands.length,3);assert.equal(commands[2].key,receiptKey);assert.equal(commands[1].key,commands[2].key);
 for(const {command,key} of commands){assert.deepEqual(command,{schema_version:1,type:'skill.review',payload:{proposal_id:proposal.id,expected_proposal_revision:7,decision:'approve'}});assert.match(key,/^[0-9a-f-]{36}$/);}
 await open('reject',fresh.id);assert.equal(await evaluate('Boolean(document.querySelector("#editor [name=affirm]"))'),false);await submit();await wait('!document.querySelector("#editor").open');
 assert.equal(commands.length,4);assert.deepEqual(commands[3].command,{schema_version:1,type:'skill.review',payload:{proposal_id:fresh.id,expected_proposal_revision:1,decision:'reject'}});
 console.log('PASS: stale-base approval disabled/rejection available, new skill has no invented prior version, keyboard Space/Tab/Enter, server error alert, exact approve/reject envelopes and same-key explicit uncertain retry (4 synthetic requests).');
 console.log('Screenshots: skill-review-{desktop,offline-narrow,new-narrow,error-desktop}.png; Chromium 1280×900 and 390×844 at DPR 2. No live backend/account/native-shell verification.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
