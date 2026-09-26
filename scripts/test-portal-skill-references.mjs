#!/usr/bin/env node
// Actual Chromium + synthetic HTTP only; no installed documents or live grants.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`refs-${randomUUID().slice(0,8)}`,bot=randomUUID();
const base={name:'Reference procedure',description:'Check inputs',when_to_use:'When asked',inputs_access:['Owner input'],steps:['Read input'],decision_rules:['Ask if unclear'],validation:['Check source'],output:'Summary',failure_handling:['Report gaps'],approval_boundaries:['Never send'],contains_private_facts:false};
const original=[{name:'source.md',text:'  Leading spaces\r\nUnicode 😀 and literal \\n\n<img src=x onerror="window.injected=true">\n[not fetched](https://invalid.example)'},{name:'remove.txt',text:'Old second document\nKeep exact trailing spaces  '}];
const skill={id:randomUUID(),kind:'skill',revision:4,body:{...base,references:original}},legacy={id:randomUUID(),kind:'skill',revision:1,body:{...base,name:'Legacy procedure'}},empty={id:randomUUID(),kind:'skill',revision:2,body:{...base,name:'Explicit empty',references:[]}};
const changed=[{name:'source.md',text:'Changed first document\n<script>not executable</script>'},{name:'added.txt',text:'New third document'}];
const proposal={id:randomUUID(),skill_id:skill.id,proposal_revision:1,expected_skill_revision:4,status:'pending',body:{...base,references:changed},provenance:{kind:'owner',source_ref:'synthetic'}};
const historical={revision:3,body:{...base,references:[{name:'history.md',text:'Historical text <b>literal</b>\nNo current references retained'}]},created_at:'2026-08-01T00:00:00Z'};
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Travel'}},skill,legacy,empty],runs:[],skill_proposals:[proposal],skill_enablements:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const commands=[],requests=[],receipts=new Map(),failures=[];let lose=false,offline=false;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const click=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'})`);await browser('click',selector);};
const refresh=async()=>{
 await browser('eval','document.querySelector("#refresh").onclick()');
 // Refresh can return early during an in-flight poll. Observe the actual fixture
 // revision/content before editing, rather than assuming the click loaded it.
 const proposed=proposal.body.references,malformed=!Array.isArray(proposed)||proposed.some(r=>r===null);
 await wait(`(()=>{if(document.querySelector('#connection').textContent!==${JSON.stringify(offline?'Offline':'Connected')})return false;if(${offline})return true;const card=document.querySelector('.skill-card:not(.proposal)'),section=document.querySelector('.proposal [data-skill-field=references] .skill-references:last-child');const documents=element=>Array.from(element.querySelectorAll('.card')).map(c=>({name:c.querySelector('h4').textContent,text:c.querySelector('.message-body').textContent}));return card?.querySelector('summary .status').textContent===${JSON.stringify(`Revision ${skill.revision}`)}&&JSON.stringify(documents(card.querySelector(':scope > .skill-references')))===${JSON.stringify(JSON.stringify(skill.body.references))}&&(${malformed}?section?.textContent.includes('Invalid stored reference data'):JSON.stringify(documents(section))===${JSON.stringify(JSON.stringify(proposed))});})()`);
};
const close=()=>browser('press','Escape');
const submit=()=>browser('eval','document.querySelector("#editor-form button[type=submit]").click()');
const affirm=()=>browser('eval','document.querySelector("#editor [name=affirm]").checked=true');
const set=(selector,value)=>browser('eval',`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
const refs='.reference-editor-row';
const name=n=>`${refs}:nth-child(${n}) input`,text=n=>`${refs}:nth-child(${n}) textarea`;
const editorText=()=>evaluate('document.querySelector("#editor").textContent');
const localReject=async pattern=>{const before=commands.length;await submit();await wait('!document.querySelector("#editor-form button[type=submit]").disabled');assert.equal(commands.length,before);if(pattern)assert.match(await evaluate('document.querySelector("#editor-error").textContent'),pattern);};
const openUpdate=async index=>{await browser('eval',`(()=>{const card=document.querySelectorAll('.skill-card:not(.proposal)')[${index}];card.open=true;[...card.querySelectorAll('.actions button')].find(b=>b.textContent==='Propose an update').click()})()`);await wait('document.querySelector("#editor").open');};
const saved=async()=>{await submit();try{await wait('!document.querySelector("#editor").open');}catch(error){throw new Error(`Save failed after ${commands.length} requests: ${await evaluate('JSON.stringify({error:document.querySelector("#editor-error").textContent,valid:document.querySelector("#editor-form").checkValidity(),connection:document.querySelector("#connection").textContent})')}`,{cause:error});}};
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'http://fixture');requests.push(`${req.method} ${req.url}`);
  if(req.method==='POST'&&url.pathname==='/v1/commands'){
   // A network chunk may end inside an emoji; decode across chunk boundaries.
   req.setEncoding('utf8');
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<256000);}
   const command=JSON.parse(raw),key=req.headers['idempotency-key'];commands.push({command,key,raw});
   assert.ok(['skill.propose','skill.restore'].includes(command.type));
   if(receipts.has(key)){assert.equal(raw,receipts.get(key).raw);return json(receipts.get(key).response);}
   if(command.type==='skill.propose'){
    assert.equal(command.payload.executable_files_changed,false);assert.equal(command.payload.body.contains_private_facts,false);
    const references=command.payload.body.references??[];assert.ok(references.length<=4);assert.equal(new Set(references.map(r=>r.name)).size,references.length);
    for(const r of references){assert.match(r.name,/^[a-z0-9][a-z0-9._-]{0,63}\.(md|txt)$/);assert.ok([...r.text].length>=1&&[...r.text].length<=16000);}
   }
   const response={id:randomUUID(),status:'applied'};receipts.set(key,{raw,response});
   if(lose){lose=false;return json({error:{message:'Synthetic response lost; proposal outcome uncertain'}},503);}return json(response);
  }
  assert.equal(req.method,'GET');
  if(url.pathname==='/v1/state')return offline?json({error:{message:'Synthetic offline'}},503):json(state);
  if(url.pathname===`/v1/skills/${skill.id}/revisions`){assert.equal(url.search,'?limit=10');return json({skill_id:skill.id,current_revision:4,revisions:[historical],next_cursor:null});}
  if(url.pathname.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(url.pathname.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[url.pathname];
  if(!file){assert.equal(url.pathname,'/favicon.ico');res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL(`../public/${file}`,import.meta.url)));
 }catch(error){failures.push(error.message);json({error:{message:'FIXTURE_REJECTED'}},400);}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=async(label,selector)=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`skill-references-${label}.png`,artifacts).pathname));};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');await click('#show-skills');await refresh();
 await browser('eval','document.querySelectorAll(".skill-card").forEach(c=>c.open=true)');
 const comparison='.proposal [data-skill-field=references]';
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${comparison} .skill-references')).map(s=>Array.from(s.querySelectorAll('.card')).map(c=>({name:c.querySelector('h4').textContent,text:c.querySelector('.message-body').textContent})))`),[original,changed]);
 assert.match(await evaluate(`document.querySelector('${comparison}>h4').textContent`),/Changed/);assert.equal(await evaluate('!!window.injected||!!document.querySelector("#timeline img,#timeline script,#timeline .skill-references a")'),false);
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".skill-card:not(.proposal) > .skill-references .card")).map(c=>({name:c.querySelector("h4").textContent,text:c.querySelector(".message-body").textContent}))'),original);
 await capture('comparison-desktop',comparison);
 await browser('set','viewport','390','844','2');await capture('comparison-narrow',comparison);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await browser('set','viewport','1280','900','2');
 await browser('eval','document.querySelector(".proposal [data-action=skill-approve]").click()');assert.match(await editorText(),/remove.txt/);assert.match(await editorText(),/added.txt/);assert.match(await editorText(),/already-admitted tasks/);await close();
 proposal.body.references=[];await refresh();assert.match(await evaluate(`document.querySelector('${comparison}').textContent`),/Changed.*source.md.*remove.txt.*ProposedNone \(explicit empty list\)/s);proposal.body.references=changed;await refresh();
 // Imported retained bodies bypass ingress: show invalid data without breaking rejection.
 for(const malformed of [{name:'bad.md',text:'Not an array'},[null]]){
  proposal.body.references=malformed;await refresh();assert.equal(await evaluate('document.querySelector("#connection").textContent'),'Connected');
  assert.match(await evaluate(`document.querySelector('${comparison}').textContent`),/Invalid stored reference data/);
  await browser('eval','document.querySelector(".proposal [data-action=skill-reject]").click()');assert.match(await editorText(),/Invalid stored reference data/);await close();
 }
 proposal.body.references=changed;skill.body.references=Array.from({length:5},(_,i)=>({name:`ref-${i}.md`,text:`Retained ${i}`}));await refresh();
 await openUpdate(0);await affirm();await localReject(/Invalid stored reference data/);await capture('invalid-import','.skill-reference-editor');await close();skill.body.references=original;await refresh();
 // An unrelated edit preserves every text byte, including CRLF and backslashes.
 await openUpdate(0);await set('#editor [name=description]','Unrelated purpose edit');await localReject();await affirm();await saved();assert.deepEqual(commands.at(-1).command.payload.body.references,original);
 await openUpdate(1);await affirm();await saved();assert.equal(Object.hasOwn(commands.at(-1).command.payload.body,'references'),false);
 await openUpdate(2);await affirm();await saved();assert.deepEqual(commands.at(-1).command.payload.body.references,[]);
 // Changed targets cannot silently overwrite another skill with empty documents.
 await openUpdate(1);await affirm();await set('#editor [name=target]',skill.id);await localReject(/target changed/);await close();
 await openUpdate(0);await affirm();await set(name(2),'source.md');await localReject(/unique/);await set(name(2),'remove.txt');
 for(const invalid of ['../source.md','Upper.md','bad.js','a'.repeat(65)+'.md']){await set(name(1),invalid);await localReject();assert.equal(await evaluate(`document.querySelector('${name(1)}').checkValidity()`),false);}
 await set(name(1),'a'.repeat(64)+'.md');assert.equal(await evaluate(`document.querySelector('${name(1)}').checkValidity()`),true);await set(name(1),'source.md');
 await set(text(1),'');await localReject();
 await browser('eval',`document.querySelector('${text(1)}').value='😀'.repeat(16001)`);await localReject(/Unicode codepoints/);
 await browser('eval',`document.querySelector('${text(1)}').value='😀'.repeat(16000)`);await saved();assert.equal(commands.at(-1).command.payload.body.references[0].text,'😀'.repeat(16000));
 await openUpdate(0);await click('[data-action=add-reference]');await click('[data-action=add-reference]');assert.equal(await evaluate('document.querySelector("[data-action=add-reference]").disabled'),true);await browser('eval','document.querySelector("[data-action=add-reference]").onclick()');assert.equal(await evaluate(`document.querySelectorAll('${refs}').length`),4);
 await set(name(3),'third.txt');await set(text(3),'3');await set(name(4),'fourth.md');await set(text(4),'4');await affirm();await saved();assert.equal(commands.at(-1).command.payload.body.references.length,4);
 // Removal is explicit [], not omitted, and remains only a proposal.
 await openUpdate(0);await click('[data-action=remove-reference]');await click('[data-action=remove-reference]');await affirm();await saved();assert.deepEqual(commands.at(-1).command.payload.body.references,[]);assert.deepEqual(skill.body.references,original);
 // Author changed, removed and added refs; uncertainty fingerprint covers them.
 await openUpdate(0);await set(text(1),changed[0].text);await click(`${refs}:nth-child(2) [data-action=remove-reference]`);await click('[data-action=add-reference]');await set(name(2),changed[1].name);await set(text(2),changed[1].text);await capture('editor-desktop','.skill-reference-editor');
 await browser('set','viewport','390','844','2');await capture('editor-narrow','.skill-reference-editor');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await capture('editor-controls-narrow','[data-action=add-reference]');assert.equal(await evaluate('(()=>{const fields=document.querySelector("#editor-fields").getBoundingClientRect(),footer=document.querySelector("#editor .dialog-footer").getBoundingClientRect(),add=document.querySelector("[data-action=add-reference]").getBoundingClientRect();return footer.top>=fields.bottom&&add.top>=fields.top&&add.bottom<=fields.bottom})()'),true);await browser('set','viewport','1280','900','2');
 await affirm();lose=true;await submit();await wait('!document.querySelector("#editor-error").hidden');await wait('!document.querySelector("#editor-form button[type=submit]").disabled');const first=commands.at(-1),count=commands.length;assert.deepEqual(first.command.payload.body.references,changed);
 await set(text(1),'Changed after lost response');await localReject(/already submitted/);assert.equal(commands.length,count);await set(text(1),changed[0].text);await saved();assert.deepEqual(commands.at(-1),first);
 // New authoring follows the same bounded editor, without target switching.
 await click('.skills-heading .primary');for(const [key,value] of Object.entries(base)){if(key==='contains_private_facts')continue;await set(`#editor [name=${key}]`,Array.isArray(value)?value.join('\n'):value);}
 await click('[data-action=add-reference]');await set(name(1),'new.txt');await set(text(1),'  New text\nLiteral \\n 😀  ');await affirm();await saved();assert.deepEqual(commands.at(-1).command.payload.body.references,[{name:'new.txt',text:'  New text\nLiteral \\n 😀  '}]);
 await openUpdate(0);await affirm();offline=true;await refresh();await localReject(/offline/);offline=false;await refresh();skill.revision=5;await refresh();await localReject(/stale/);skill.revision=4;await close();await refresh();
 // History and restore confirmation disclose source refs fully, without a write.
 await browser('eval','document.querySelector("[data-action=skill-history]").click()');await wait('!!document.querySelector("[data-source-revision]")');await browser('eval','document.querySelector("[data-source-revision]").open=true');
 assert.equal(await evaluate('document.querySelector("[data-source-revision] .skill-references .message-body").textContent'),historical.body.references[0].text);
 await browser('eval','document.querySelector("[data-source-revision] [data-action=stage-restore]").click()');assert.match(await editorText(),/Approving it removes current references absent from this source/);assert.equal(await evaluate('document.querySelector("#editor .skill-references .message-body").textContent'),historical.body.references[0].text);
 await capture('restore-desktop','#editor .skill-references');await browser('set','viewport','390','844','2');await capture('restore-narrow','#editor .skill-references');await browser('set','viewport','1280','900','2');
 await localReject();await browser('eval','document.querySelector("#editor [name=confirm]").checked=true');await saved();assert.equal(commands.at(-1).command.type,'skill.restore');assert.equal(commands.at(-1).command.payload.source_revision,3);assert.deepEqual(skill.body.references,original);
 const before=commands.length,reads=requests.filter(r=>r.includes('/revisions')).length;state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:'2099-01-01T00:00:00Z',max_runs:1,admitted_runs:0,max_task_seconds:60};await refresh();assert.equal(await evaluate('document.querySelectorAll("[data-action=skill-history]").length'),0);assert.equal(commands.length,before);assert.equal(requests.filter(r=>r.includes('/revisions')).length,reads);assert.deepEqual(failures,[]);
 console.log('PASS: full safe catalog/comparison/history/restore references; changed/removed/added documents; authoring name/duplicate/4-item/16000-codepoint bounds (emoji boundary); exact text and omitted/empty preservation; unrelated edit retention; target-change rejection; same-key uncertain retry and changed-reference fence; private-facts/stale/offline/alpha guards; no unreviewed approval/activation/URL fetch; 2x desktop/narrow Chromium.');
}finally{await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
