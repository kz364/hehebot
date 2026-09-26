#!/usr/bin/env node
// Real Chromium and synthetic HTTP only; no live model, account, provider, effect, push, or deployment.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`skill-run-${randomUUID().slice(0,6)}`,skillId=randomUUID(),bot=randomUUID(),other=randomUUID();
const skill={id:skillId,kind:'skill',revision:7,body:{name:'Prepare trip brief',description:'Build a concise brief.',when_to_use:'Before travel',inputs_access:['Supplied input'],steps:['Review input'],decision_rules:['Ask if unclear'],validation:['Check dates'],output:'Brief',failure_handling:['Explain gaps'],approval_boundaries:['Do not book'],contains_private_facts:false}};
const persona={id:bot,kind:'persona',revision:3,body:{name:'Travel',archived:false}},archived={id:other,kind:'persona',revision:11,body:{name:'Old bot',archived:true}};
const alternative={id:randomUUID(),kind:'persona',revision:13,body:{name:'Research',archived:false}};
const state={objects:[persona,archived,alternative,skill],runs:[],skill_proposals:[],skill_enablements:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const requests=[],events=[],receipts=new Map();let offline=false,mode='applied';
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout),wait=code=>browser('wait','--fn',code);
const click=selector=>browser('click',selector),refresh=async()=>{await browser('eval','document.querySelector("#refresh").onclick()');await wait(`document.querySelector('#connection').textContent===${JSON.stringify(offline?'Offline':'Connected')}`);};
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname;
 req.setEncoding('utf8');
 if(req.method==='POST'&&path==='/v1/commands'){let raw='';for await(const chunk of req)raw+=chunk;const key=req.headers['idempotency-key'],body=JSON.parse(raw);requests.push({raw,key,body});assert.equal(body.type,'skill.run');if(!receipts.has(key)){receipts.set(key,{raw,result:{status:'applied',id:randomUUID(),resource_id:randomUUID()}});events.push({id:randomUUID(),sequence:1,conversation_id:bot,type:'message.user',created_at:'2026-09-17T00:00:00Z',payload:{text:body.payload.text,skill_invocation:{skill_id:skillId,skill_revision:7,skill_name:'Prepare trip brief'}}});}else assert.equal(raw,receipts.get(key).raw);if(mode==='lost'){mode='applied';return json(res,{error:{message:'reply lost'}},503);}return json(res,receipts.get(key).result);}
 if(path==='/v1/state')return offline?json(res,{error:{message:'Synthetic offline'}},503):json(res,state);
 if(path.endsWith('/tasks'))return json(res,{counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
 if(path.startsWith('/v1/conversations/'))return json(res,{events:path.includes(bot)?events:[],has_more:false,pruned_through:0});
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){json(res,{error:{message:String(error)}},400);}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async name=>{await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`skill-run-${name}.png`,artifacts).pathname));};
const open=async()=>{await click('#show-skills');await wait('document.querySelector("[data-action=skill-run]")');await browser('eval','document.querySelector("[data-action=skill-run]").click()');await wait('document.querySelector("#editor").open');};
const fill=async text=>{await browser('fill','#editor textarea',text);await browser('check','#editor [name=confirm]');};
const submit=()=>click('#editor-form button[type=submit]');
const localReject=async pattern=>{const before=requests.length;await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(requests.length,before);assert.match((await browser('get','text','#editor-error')).stdout,pattern);};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');await open();
 const text=(await browser('get','text','#editor')).stdout;assert.match(text,/ordinary gated work.*not a dry run.*effect approvals/s);assert.match(text,/wait durably.*30 days/s);assert.equal(await evaluate('document.querySelectorAll("#editor select option").length'),2);await fill('Create a brief for Friday.');await capture('waiting-desktop');
 await browser('set','viewport','390','844','2');await capture('waiting-narrow');await browser('eval','document.querySelector("#editor-fields").scrollTop=document.querySelector("#editor-fields").scrollHeight');
 assert.equal(await evaluate('(()=>{const fields=document.querySelector("#editor-fields").getBoundingClientRect(),footer=document.querySelector("#editor .dialog-footer").getBoundingClientRect(),check=document.querySelector("#editor .affirmation").getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&footer.top>=fields.bottom&&check.top>=fields.top&&check.bottom<=fields.bottom})()'),true);await capture('controls-narrow');await browser('set','viewport','1280','900','2');
 await browser('fill','#editor textarea','  \n ');await localReject(/nonblank/);await browser('eval',`document.querySelector('#editor textarea').value='😀'.repeat(8193)`);await localReject(/UTF-8 bytes/);await fill('Create a brief for Friday.');
 let boundary=0;for(const mutate of [()=>skill.revision++,()=>state.objects.splice(state.objects.indexOf(skill),1),()=>persona.revision++,()=>persona.body.archived=true,()=>{offline=true}]){
  boundary++;
  const original={skillRevision:skill.revision,hasSkill:state.objects.includes(skill),personaRevision:persona.revision,archived:persona.body.archived,alpha:state.summary.owner_alpha};mutate();await refresh();try{await localReject(/changed|alpha mode|connection/);}catch(error){error.message=`boundary ${boundary}: ${error.message}`;throw error;}offline=false;state.summary.owner_alpha=original.alpha;if(!original.alpha)delete state.summary.owner_alpha_session;persona.revision=original.personaRevision;persona.body.archived=original.archived;skill.revision=original.skillRevision;if(original.hasSkill&&!state.objects.includes(skill))state.objects.push(skill);await refresh();
 }
 await browser('eval','document.querySelector("#bots .nav-item").click()');await localReject(/navigation|changed/);await browser('press','Escape');await open();await fill('First input');mode='lost';await submit();await wait('!document.querySelector("#editor-error").hidden');assert.equal(requests.length,1);const first=structuredClone(requests[0]);
 await browser('fill','#editor textarea','Changed input');await localReject(/unchanged bot and input/);await browser('fill','#editor textarea','First input');await submit();await wait('!document.querySelector("#editor").open');assert.equal(requests.length,2);assert.equal(requests[1].key,first.key);assert.equal(requests[1].raw,first.raw);
 assert.deepEqual(first.body,{schema_version:1,type:'skill.run',payload:{skill_id:skillId,expected_skill_revision:7,persona_id:bot,expected_persona_revision:3,text:'First input'}});assert.match(first.key,/^[0-9a-f-]{36}$/);assert.equal(requests.every(row=>row.body.type==='skill.run'),true);assert.equal(await evaluate('document.querySelector("#conversation-name").textContent'),'Travel');
 skill.body.name='Changed current catalog name';events.push({id:randomUUID(),sequence:2,conversation_id:bot,type:'run.input_expired',created_at:'2026-10-17T00:00:00Z',payload:{skill_invocation:{skill_id:skillId,skill_revision:7}}});await refresh();await wait('document.querySelector("#timeline").textContent.includes("captured revision 7")');
 assert.match(await evaluate('document.querySelector("#timeline").textContent'),/Run once · Prepare trip brief · captured revision 7/);assert.match(await evaluate('document.querySelector("#timeline").textContent'),/expired after 30 days/);assert.equal(events.filter(e=>e.type==='message.user').length,1);await capture('attributed-result');
 await open();await fill('Must not run in alpha');state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:'2099-01-01T00:00:00Z',max_runs:1,admitted_runs:0,max_task_seconds:60};await refresh();await localReject(/alpha mode|changed/);await browser('press','Escape');assert.equal(await evaluate('document.querySelectorAll("[data-action=skill-run]").length'),0);assert.equal(requests.length,2);
 state.summary.owner_alpha=false;delete state.summary.owner_alpha_session;await refresh();assert.equal(await evaluate('document.querySelectorAll("[data-action=skill-run]").length'),0);assert.equal(requests.length,2);
 console.log('PASS: exact asymmetric revisions/input envelope; active-only persona picker; waiting/ordinary-effects disclosure; stale/deleted/archived/offline/navigation-alpha zero dispatch; changed uncertain retry blocked; unchanged retry identical UUID/key/body; success navigation; no enablement or other actions.');
 console.log('Screenshots: skill-run-{waiting-desktop,waiting-narrow}.png at DPR2. Synthetic HTTP/Chromium only.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
