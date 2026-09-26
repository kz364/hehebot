#!/usr/bin/env node
// Synthetic browser fixtures only; no model, account, provider or gateway calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID(),room=randomUUID(),session='alpha-'+randomUUID().slice(0,8);
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Travel'}},{id:other,kind:'persona',revision:1,body:{name:'Inbox'}},{id:room,kind:'room',revision:1,body:{name:'Planning room'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const run={id:randomUUID(),persona_id:bot,title:'Synthetic in-flight reply',role:'coordinator',status:'running',current_attempt:1};
const commands=[],commandKeys=[];let reads=0,deniedReads=0,offline=false,failMessage=false,reviewNumber=0;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
// The G5 durable outbox (GROK_ALIGNMENT A5) sends via an async drain loop
// instead of a synchronous command() call, so a click no longer guarantees
// the server has the POST by the time the composer clears. Poll the
// Node-side `commands` array (populated by the fixture's own HTTP handler)
// instead of asserting its length immediately after a UI wait.
const waitForCommands=async(n,timeoutMs=5000)=>{const start=Date.now();while(commands.length<n){if(Date.now()-start>timeoutMs)throw new Error(`Timed out waiting for ${n} commands (have ${commands.length})`);await new Promise(r=>setTimeout(r,25));}};
// window.__hehebotOutbox() is the read-only test hook the outbox exposes
// (nonce/conversation_id/text/phase only) in place of the old single
// 'personal.pending.<conversation>' localStorage key.
const outboxRecordFor=async conversationId=>(await evaluate('window.__hehebotOutbox()')).find(r=>r.conversation_id===conversationId);
// The G5 outbox only clears its optimistic bubble once the timeline echoes
// the command's Idempotency-Key on a message.user event (GROK_ALIGNMENT A5).
// A static /events fixture would leave every send's outbox record forever
// in 'accepted' phase, wedging `sending` (and #send.disabled) permanently
// true from the first message on. Echo real sends alongside the fixed
// 'Retained synthetic history' entry so reconciliation actually completes.
let historySeq=1;const sentEvents=[];
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/v1/commands'){
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  commands.push(body);commandKeys.push(req.headers['idempotency-key']);
  if(failMessage)return json({error:{message:'Synthetic lost response'}},503);
  if(body.type==='message.send')sentEvents.push({sequence:++historySeq,conversation_id:body.payload.conversation_id,type:'message.user',created_at:new Date().toISOString(),payload:{text:body.payload.text,idempotency_key:req.headers['idempotency-key']}});
  return json({status:'applied'});
 }
 if(path==='/v1/state'){reads++;return json(offline?{error:{message:'Synthetic offline'}}:state,offline?503:200);}
 if(state.summary.owner_alpha&&path.startsWith('/v1/conversations/')&&!path.startsWith(`/v1/conversations/${bot}/`)){deniedReads++;return json({error:{message:'Conversation unavailable in session'}},403);}
 if(path.endsWith('/events')){
  const id=path.split('/')[3];
  const fixed=id===bot?[{sequence:1,conversation_id:bot,type:'message.user',created_at:new Date().toISOString(),payload:{text:'Retained synthetic history'}}]:[];
  return json({events:[...fixed,...sentEvents.filter(e=>e.conversation_id===id)]});
 }
 if(path.endsWith('/tasks')||path.endsWith('/recovery'))return json({runs:[],counts:{total:0,waiting:0,recovery:0},next_cursor:null});
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
 if(!file){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(new URL('../public/'+file,import.meta.url)));
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async()=>{await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');};
const refresh=async()=>{const before=reads;state.summary.queued_runs++;await evaluate('document.querySelector("#refresh").click()');await wait(`document.querySelector('#runtime-queued').textContent===${JSON.stringify(String(state.summary.queued_runs))}`);assert.ok(reads>before);};
const capture=async name=>{
 // Taller review capture includes the expanded preview; interactions still run at 900px.
 await browser('set','viewport','1280','1200','2');
 await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',new URL(`portal-alpha-${name}.png`,artifacts).pathname);
 await browser('set','viewport','1280','900','2');
};
const blocked=async()=>{assert.equal(await evaluate('document.querySelector("#send").disabled'),true);const n=commands.length;await evaluate('document.querySelector("#message").value="Blocked draft"; document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);};
try{
 await open();assert.equal(await evaluate('document.querySelector("#send").disabled'),false);await capture('default');
 await browser('fill','#message','Ordinary saved message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(1);assert.equal(commands.length,1);
 state.summary.owner_alpha=true;state.summary.owner_alpha_session={persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_runs:2,admitted_runs:1,max_task_seconds:43};await refresh();
 state.runs=[run];state.output_previews=[{run_id:run.id,attempt:1,text:'Synthetic provisional reply, not a completed result',version:1}];await refresh();
 await evaluate('document.querySelector(".task-card").open=true');
 assert.equal(await evaluate('document.querySelector("#send").disabled'),false);assert.match(await evaluate('document.querySelector("#runtime-banner").textContent'),/1 of 2 admissions remaining/);await capture('available');
 await browser('fill','#message','Alpha request');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(2);assert.equal(commands.length,2);
 offline=true;await evaluate('document.querySelector("#refresh").click()');await wait('document.querySelector("#connection").textContent==="Offline"');await blocked();offline=false;await refresh();await wait('!document.querySelector("#send").disabled');
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await blocked();await capture('wrong-persona');
 await refresh();assert.equal(await evaluate('document.querySelector("#connection").textContent'),'Connected');assert.match(await evaluate('document.querySelector("#timeline").textContent'),/History and task pages are unavailable/);
 await evaluate('document.querySelector("#rooms button").click()');await blocked();await refresh();assert.equal(await evaluate('document.querySelector("#connection").textContent'),'Connected');assert.equal(deniedReads,0);
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);await wait('!document.querySelector("#send").disabled');
 state.summary.owner_alpha_session.admitted_runs=2;await refresh();await blocked();await capture('exhausted');
 state.summary.owner_alpha_session.admitted_runs=0;await refresh();await blocked();
 // A fresh page is required for a different session. Expiry itself needs no fetch or write.
 state.summary.owner_alpha_session.expires_at=new Date(Date.now()+2500).toISOString();await open();
 const beforeExpiry=reads;await wait('document.querySelector("#runtime-banner").textContent.includes("Session expired")');assert.equal(reads,beforeExpiry);await blocked();
 await evaluate('document.querySelector(".task-card").open=true');assert.match(await evaluate('document.querySelector(".task-card").textContent'),/Synthetic provisional reply/);await capture('expired');
 await evaluate('document.querySelector(".task-card .danger").scrollIntoView({behavior:"instant",block:"center"})');await browser('click','.task-card .danger');await wait('document.querySelector("#editor").open');await browser('check','#editor [name=confirm]');await browser('click','#editor-form button[type=submit]');await wait('!document.querySelector("#editor").open');assert.equal(commands.at(-1).type,'run.cancel');assert.equal(commands.at(-1).payload.run_id,run.id);
 await evaluate('Date.now=()=>0');await refresh();await blocked();
 state.summary.owner_alpha_session.expires_at=new Date(Date.now()+60000).toISOString();await refresh();await blocked();
 assert.match(await evaluate('document.querySelector("#timeline").textContent'),/Retained synthetic history/);
 await evaluate('[...document.querySelectorAll("#timeline button")].find(b=>b.textContent==="Review recovery tasks").click()');await wait('document.querySelector("#timeline").textContent.includes("No recovery tasks")');
 delete state.summary.owner_alpha_session;await open();await blocked();assert.match(await evaluate('document.querySelector("#runtime-banner").textContent'),/details changed or are unavailable/);
 assert.equal(commands.length,3);assert.deepEqual(commands.map(c=>c.type),['message.send','message.send','run.cancel']);assert.equal(deniedReads,0);
 console.log('PASS default/available send, wrong persona/room, exhausted/stale count, zero-fetch timer expiry/clock rollback/changed deadline, retained preview/history/recovery, exact cancel after expiry and blocked programmatic submit; no automatic writes.');
 // Automatic trials have a fixed overall policy, independent of expired legacy
 // session bounds. Only an explicit message submits a command; reads do not.
 state.summary.owner_alpha_session={persona_id:bot,expires_at:'2026-01-01T00:00:00.000Z',max_runs:1,admitted_runs:1,max_task_seconds:43};
 state.summary.owner_alpha_bootstrap={policy_revision:'synthetic-policy-1',persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_task_seconds:43,message_admission_available:true};
 await open();await refresh();
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await blocked();
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);await wait('!document.querySelector("#send").disabled');
 assert.equal(commands.length,3);assert.match(await evaluate('document.querySelector("#runtime-banner").textContent'),/Portal visits and history do not start the runtime/);
 await capture('bootstrap-available');
 await browser('fill','#message','Start one new bounded session');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(4);
 assert.equal(commands.length,4);assert.deepEqual(commands[3].payload,{conversation_id:bot,text:'Start one new bounded session'});
 state.summary.owner_alpha_bootstrap.message_admission_available=false;await refresh();await blocked();await capture('bootstrap-unavailable');
 state.summary.owner_alpha_bootstrap.message_admission_available=true;await refresh();await wait('!document.querySelector("#send").disabled');
 state.summary.owner_alpha_session.expires_at=new Date(Date.now()+300000).toISOString();await refresh();assert.equal(await evaluate('document.querySelector("#send").disabled'),false);
 delete state.summary.owner_alpha_bootstrap;await refresh();await blocked();
 state.summary.owner_alpha_bootstrap={policy_revision:'synthetic-policy-2',persona_id:bot,expires_at:new Date(Date.now()+2500).toISOString(),max_task_seconds:43,message_admission_available:true};
 await open();const beforeTrialExpiry=reads;await wait('document.querySelector("#runtime-banner").textContent.includes("Trial expired")');
 assert.equal(reads,beforeTrialExpiry);await blocked();await capture('bootstrap-expired');
 assert.equal(commands.length,4);assert.equal(deniedReads,0);
 console.log('PASS message-triggered trial: expired legacy session does not close eligible message admission; visits/refresh/bot switching make zero commands; one explicit Send; unavailable/missing metadata and local trial expiry close admission; generation changes do not renew the trial.');
 // Explicit adoption changes only local reviewed policy; it never submits or
 // discards a draft, renews an old deadline, or replays an uncertain command.
 const nextPolicy=(revision,ttl=120000)=>({policy_revision:revision,persona_id:bot,expires_at:new Date(Date.now()+ttl).toISOString(),max_task_seconds:83,message_admission_available:true});
 const clickReview=async()=>{
  reviewNumber++;await wait('!document.querySelector("#review-alpha-session").disabled');
  await evaluate('document.querySelector("#review-alpha-session").scrollIntoView({behavior:"instant",block:"center"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await evaluate('globalThis.lastReviewClick=null;document.addEventListener("click",e=>{globalThis.lastReviewClick={id:e.target.id,text:e.target.textContent?.slice(0,100)}},{once:true,capture:true})');
  await browser('click','#review-alpha-session');
  await wait('globalThis.lastReviewClick!==null');
  assert.equal((await evaluate('globalThis.lastReviewClick'))?.id,'review-alpha-session','The real review click must reach its enabled button.');
 };
 const review=async()=>{await clickReview();await wait('document.querySelector("#editor").open');};
 const confirm=async()=>{await browser('check','#editor [name=confirm]');await browser('click','#editor-form button[type=submit]');};
 const dismiss=async()=>{await browser('click','#cancel-editor');await wait('!document.querySelector("#editor").open');};
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-3');await refresh();
 await evaluate('document.querySelector("#message").value="Preserved unsent draft";document.querySelector("#message").dispatchEvent(new Event("input"))');
 assert.equal(await evaluate('document.querySelector("#send").disabled'),true);await capture('session-changed');
 await review();assert.equal(commands.length,4);assert.match(await evaluate('document.querySelector("#editor-fields").textContent'),/synthetic-policy-3/);
 await capture('session-review');await browser('set','viewport','390','844','2');await browser('screenshot',new URL('portal-alpha-session-review-narrow.png',artifacts).pathname);await browser('set','viewport','1280','900','2');
 await dismiss();assert.equal(await evaluate('document.querySelector("#send").disabled'),true);
 await review();state.summary.owner_alpha_bootstrap.max_task_seconds=84;await confirm();
 await wait('!document.querySelector("#editor-error").hidden');assert.match(await evaluate('document.querySelector("#editor-error").textContent'),/changed or expired/);
 assert.equal(commands.length,4);await dismiss();
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-4');await refresh();await review();
 state.summary.owner_alpha_bootstrap.message_admission_available=false;await confirm();await wait('!document.querySelector("#editor-error").hidden');
 assert.match(await evaluate('document.querySelector("#editor-error").textContent'),/No available/);await dismiss();state.summary.owner_alpha_bootstrap.message_admission_available=true;
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await refresh();
 await clickReview();await wait('document.querySelector("#error").textContent.includes("selected persona")');assert.equal(await evaluate('document.querySelector("#editor").open'),false);
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);await refresh();
 await review();await confirm();await wait('!document.querySelector("#editor").open&&!document.querySelector("#send").disabled');
 assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved unsent draft');
 assert.equal(await evaluate(`localStorage.getItem('personal.draft.${bot}')`),'Preserved unsent draft');assert.equal(commands.length,4);await capture('session-adopted');
 // A same-revision deadline edit and rollback to a previously adopted revision
 // cannot renew its local monotonic expiry through the review action.
 state.summary.owner_alpha_bootstrap.expires_at=new Date(Date.now()+180000).toISOString();await refresh();
 await clickReview();await wait('document.querySelector("#error").textContent.includes("already reviewed")');assert.equal(await evaluate('document.querySelector("#send").disabled'),true);
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-2');await refresh();await clickReview();await wait('document.querySelector("#error").textContent.includes("already reviewed")');
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-5',5000);await refresh();await review();
 await evaluate('globalThis.realDateNow=Date.now;Date.now=()=>0;new Promise(resolve=>setTimeout(resolve,5100))');await confirm();
 await wait('!document.querySelector("#editor-error").hidden');assert.match(await evaluate('document.querySelector("#editor-error").textContent'),/changed or expired/);
 await evaluate('Date.now=globalThis.realDateNow');await dismiss();assert.equal(commands.length,4);
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-6');await refresh();await review();
 offline=true;await evaluate('document.querySelector("#refresh").click()');await wait('document.querySelector("#connection").textContent==="Offline"');await confirm();
 await wait('!document.querySelector("#editor-error").hidden');assert.match(await evaluate('document.querySelector("#editor-error").textContent'),/connection changed/);
 offline=false;await dismiss();await refresh();await review();await confirm();await wait('!document.querySelector("#editor").open&&!document.querySelector("#send").disabled');
 // A lost/failed response (5xx) is neither an outright rejection (4xx, which
 // restores the draft) nor a confirmed send: the G5 outbox keeps retrying
 // under the same Idempotency-Key (GROK_ALIGNMENT A5) instead of the old
 // single 'personal.pending.<conversation>' localStorage record.
 failMessage=true;const beforeUnconfirmed=commands.length;
 await browser('fill','#message','Unconfirmed exact request');await browser('click','#send');
 await wait('document.querySelector(".outbox-status")?.textContent.includes("Not delivered")');
 await waitForCommands(beforeUnconfirmed+1);
 const unconfirmedKey=commandKeys[beforeUnconfirmed];
 assert.ok(commandKeys.slice(beforeUnconfirmed).every(k=>k===unconfirmedKey),'every retry under a lost response reuses the same Idempotency-Key');
 let pendingOutbox=await outboxRecordFor(bot);
 assert.equal(pendingOutbox?.text,'Unconfirmed exact request');assert.equal(pendingOutbox?.nonce,unconfirmedKey);assert.equal(pendingOutbox?.phase,'unknown');
 assert.equal(await evaluate('document.querySelector("#message").value'),'','the composer clears immediately; the unsent text lives only in the optimistic outbox bubble, not the draft');
 state.summary.owner_alpha_bootstrap=nextPolicy('synthetic-policy-7');await refresh();
 // One unconfirmed send blocks alpha-session review at the control itself
 // (GROK_ALIGNMENT A5) — the button is disabled outright, unlike the old
 // pending-key check which only threw once a click reached the handler.
 // reviewAlphaSession() still refuses it when invoked directly too.
 assert.equal(await evaluate('document.querySelector("#review-alpha-session").disabled'),true,'review stays disabled while a send is unconfirmed');
 // reviewAlphaSession()'s assertReady() checks the broader `sending` flag
 // (now derived from outbox non-emptiness) before its own outbox-specific
 // check, so a direct invocation reports the generic "changed" refusal
 // rather than reaching the more specific "unconfirmed outcome" message;
 // either way, nothing is adopted and the outbox record survives untouched.
 await evaluate('document.querySelector("#review-alpha-session").onclick()');
 await wait('document.querySelector("#error").textContent.includes("Close and review the session again")');
 pendingOutbox=await outboxRecordFor(bot);
 assert.equal(pendingOutbox?.text,'Unconfirmed exact request');assert.equal(pendingOutbox?.nonce,unconfirmedKey);
 assert.ok(commandKeys.slice(beforeUnconfirmed).every(k=>k===unconfirmedKey),'still no new Idempotency-Key introduced while review is blocked');
 assert.equal(await evaluate('document.querySelector("#send").disabled'),true);assert.equal(await evaluate('document.querySelector("#editor").open'),false);await capture('session-pending-blocked');
 console.log('PASS explicit session adoption: no reload/commands, reviewed identity+fresh recheck, cancel/stale/persona/offline/monotonic expiry/old revision refusal, draft preservation, and uncertain message bytes/key retained without replay.');
}catch(error){
 console.error({reviewNumber,policy:state.summary.owner_alpha_bootstrap?.policy_revision});
 console.error((await browser('errors').catch(()=>({stdout:'Browser diagnostics unavailable'}))).stdout);
 console.error(await evaluate('({connection:document.querySelector("#connection")?.textContent,error:document.querySelector("#error")?.textContent,editorError:document.querySelector("#editor-error")?.textContent,lastReviewClick:globalThis.lastReviewClick,reviewBounds:document.querySelector("#review-alpha-session")?.getBoundingClientRect().toJSON(),active:document.activeElement?.id})').catch(()=>null));
 await browser('screenshot',new URL('../.local/portal-alpha-failure.png',import.meta.url).pathname).catch(()=>{});
 throw error;
}finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
