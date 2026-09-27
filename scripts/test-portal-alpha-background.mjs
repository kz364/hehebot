#!/usr/bin/env node
// Synthetic Stage B background-generation browser fixtures only; no model,
// account, provider or gateway calls. Verifies the portal's strict
// summary.owner_alpha_background path independently of warm/legacy fences:
// pre-first availability, ordinal background/status/independent admissions
// gated by message_admission_available, exhaustion, immutable policy and
// generation deadlines with no-network timers, read-only other personas/rooms,
// conflicting-custody fail-closed behavior, malformed/missing/changed
// summaries, regressing and impossible count/generation/role combinations,
// offline/reconnect, draft/pending preservation, and zero passive commands.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID(),room=randomUUID(),session='bg-alpha-portal';
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Travel'}},{id:other,kind:'persona',revision:1,body:{name:'Inbox'}},{id:room,kind:'room',revision:1,body:{name:'Planning room'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const commands=[],commandKeys=[];
const roles=['background','status','independent'];
const gen=(ttl=60000)=>({session_id:randomUUID(),expires_at:new Date(Date.now()+ttl).toISOString(),epoch:2});
const policyDeadlines=new Map();
const background=(revision,{admissions_used=0,generation=null,available=true,policyTtl=120000}={})=>{
 if(!policyDeadlines.has(revision))policyDeadlines.set(revision,new Date(Date.now()+policyTtl).toISOString());
 state.summary.owner_alpha_background={schema_version:1,kind:'owner-alpha-background-summary-v1',policy_revision:revision,persona_id:bot,
  policy_expires_at:policyDeadlines.get(revision),max_admissions:3,admissions_used,message_admission_available:available,
  next_role:available?roles[admissions_used]??null:null,generation};
 delete state.summary.owner_alpha;delete state.summary.owner_alpha_session;delete state.summary.owner_alpha_bootstrap;delete state.summary.owner_alpha_warm;
};
let reads=0,deniedReads=0,botReads=0,offline=false,failMessage=false;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code).then(r=>r.stdout.trim()||'null')).trim());
const wait=code=>browser('wait','--fn',code);
// The V5 durable outbox (ARCHITECTURE_V2 A5) sends via an async drain loop, so
// a click no longer guarantees the server has the POST by the time the
// composer clears; poll the Node-side `commands` array instead of asserting
// its length immediately after a UI wait.
const waitForCommands=async(n,timeoutMs=5000)=>{const start=Date.now();while(commands.length<n){if(Date.now()-start>timeoutMs)throw new Error(`Timed out waiting for ${n} commands (have ${commands.length})`);await new Promise(r=>setTimeout(r,25));}};
// window.__hehebotOutbox() is the read-only test hook the outbox exposes
// (nonce/conversation_id/text/phase only) in place of the old single
// 'personal.pending.<conversation>' localStorage key.
const outboxRecordFor=async conversationId=>(await evaluate('window.__hehebotOutbox()')).find(r=>r.conversation_id===conversationId);
// A static /events fixture would leave every accepted send's outbox record
// forever unechoed, wedging `sending` (and #send.disabled) permanently true
// from the first message on. Echo real sends alongside the fixed
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
 if(path.startsWith(`/v1/conversations/${bot}/`))botReads++;
 if(state.summary.owner_alpha_background&&path.startsWith('/v1/conversations/')&&!path.startsWith(`/v1/conversations/${bot}/`)){deniedReads++;return json({error:{message:'Conversation unavailable in background generation'}},403);}
 if(path.endsWith('/events')){
  const id=path.split('/')[3];
  const fixed=id===bot?[{sequence:1,conversation_id:bot,type:'message.user',created_at:new Date().toISOString(),payload:{text:'Retained synthetic history'}}]:[];
  return json({events:[...fixed,...sentEvents.filter(e=>e.conversation_id===id)]});
 }
 if(path.endsWith('/tasks')||path.endsWith('/recovery'))return json({runs:[],counts:{total:0,waiting:0,recovery:0},next_cursor:null});
 const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js'}[path];
 if(!file){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 res.end(await readFile(new URL('../public/'+file,import.meta.url)));
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const open=async()=>{await browser('open',`http://127.0.0.1:${server.address().port}`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');};
const refresh=async()=>{const before=reads;state.summary.queued_runs++;await evaluate('document.querySelector("#refresh").click()');await wait(`document.querySelector('#runtime-queued').textContent===${JSON.stringify(String(state.summary.queued_runs))}`);assert.ok(reads>before);};
const banner=()=>evaluate('document.querySelector("#runtime-banner-text").textContent');
const blocked=async()=>{assert.equal(await evaluate('document.querySelector("#send").disabled'),true);assert.equal(await evaluate('document.querySelector("#message").readOnly'),true);const n=commands.length;await evaluate('document.querySelector("#message").value="Blocked draft"; document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);};
const enabled=async()=>{assert.equal(await evaluate('document.querySelector("#send").disabled'),false);assert.equal(await evaluate('document.querySelector("#message").readOnly'),false);};
const passive=async n=>{await refresh();await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);assert.equal(commands.length,n);};
const rollbackClock=async()=>evaluate('(()=>{globalThis.realDateNow=Date.now;Date.now=()=>0;return null})()');
const restoreClock=async()=>evaluate('(()=>{Date.now=globalThis.realDateNow;return null})()');
const capture=async name=>{await browser('set','viewport','1280','1200','2');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',decodeURIComponent(new URL(`portal-alpha-background-${name}.png`,artifacts).pathname));await browser('set','viewport','1280','900','2');};
const resetPage=async()=>{await evaluate('sessionStorage.clear()');await open();};
try{
 // Phase 0 — ordinary default mode before any background summary.
 await open();await enabled();
 await browser('fill','#message','Ordinary saved message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(1);assert.equal(commands.length,1);
 // Phase A — pre-first A admission: three of three, generation:null, next role background, passive reads send nothing.
 background('bg-1');await refresh();await enabled();
 assert.match(await banner(),/Background owner generation/);
 assert.match(await banner(),/3 of 3 messages remaining/);
 assert.match(await banner(),/Next message role: background \(starts the bounded background root\)/);
 assert.match(await banner(),/One fixed generation starts with your first Send/);
 assert.match(await banner(),/not always-on chat/);
 assert.match(await banner(),/All three admissions are finite; no renewal, rollover, successor generation or always-on background work/);
 assert.equal(await evaluate('document.querySelector("#send").getAttribute("aria-describedby")'),'runtime-banner');
 assert.equal(await evaluate('document.querySelector("#message").getAttribute("aria-describedby")'),'runtime-banner');
 assert.equal(await evaluate('document.querySelector("#runtime-banner").getAttribute("role")'),'status');
 assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);
 assert.equal(await evaluate('document.querySelector("#review-alpha-session").hidden'),true);
 await passive(1);await capture('pre-first');
 // Phase B — first message starts the background root; S blocked until the
 // coordinator releases A (an A child may remain active; the portal only
 // trusts message_admission_available and never infers release itself).
 await browser('fill','#message','Background first message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(2);assert.equal(commands.length,2);
 assert.deepEqual(commands.at(-1).payload,{conversation_id:bot,text:'Background first message'});
 const generation=gen(110000);
 background('bg-1',{admissions_used:1,generation,available:false}); // A root inference still occupies the lane
 await refresh();await blocked();
 assert.match(await banner(),/No message admission is available in this background revision/);
 assert.match(await banner(),/2 of 3 messages remaining/);
 assert.match(await banner(),/Generation 2 deadline/);
 assert.match(await banner(),/Next message role: none \(no message admission is currently available\)/);
 await capture('status-blocked');
 state.summary.owner_alpha_background.message_admission_available=true; // trusted A coordinator-release observed server-side
 state.summary.owner_alpha_background.next_role='status';
 await refresh();await enabled();
 assert.equal(await evaluate('document.querySelector("#error").hidden'),true); // stale admission error cannot contradict enabled Send
 assert.match(await banner(),/2 of 3 messages remaining/);
 assert.match(await banner(),/Next message role: status \(admitted only after the background root releases its coordinator lane\)/);
 assert.match(await banner(),/Status and independent replies do not prove the background root or its children completed or settled/);
 await capture('status-available');
 await browser('fill','#message','Background status message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(3);assert.equal(commands.length,3);
 // Phase C — B blocked until S settles canonically, then the independent admission; exhaustion.
 background('bg-1',{admissions_used:2,generation,available:false}); // S not settled yet
 await refresh();await blocked();
 assert.match(await banner(),/No message admission is available in this background revision/);
 state.summary.owner_alpha_background.message_admission_available=true; // S settled server-side
 state.summary.owner_alpha_background.next_role='independent';
 await refresh();await enabled();
 assert.match(await banner(),/1 of 3 messages remaining/);
 assert.match(await banner(),/Next message role: independent \(admitted only after the status answer settles\)/);
 await capture('independent-available');
 await browser('fill','#message','Background independent message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(4);assert.equal(commands.length,4);
 background('bg-1',{admissions_used:3,generation,available:false}); // generation admits nothing further, ever
 await refresh();await blocked();
 assert.match(await banner(),/All three background messages have been used/);
 assert.match(await banner(),/0 of 3 messages remaining/);
 await capture('exhausted');
 await open();await blocked(); // durable exhaustion survives reload
 await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,4);
 // Phase D — other personas and rooms are read-only; no denied conversation reads.
 await resetPage();background('bg-2');await open();await enabled();
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await blocked();
 assert.match(await banner(),/only for its selected persona/);
 assert.match(await evaluate('document.querySelector("#timeline").textContent'),/History and task pages are unavailable/);
 await evaluate('document.querySelector("#rooms button").click()');await blocked();
 assert.equal(deniedReads,0);
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);await wait('!document.querySelector("#send").disabled');await capture('wrong-persona-restored');
 // Phase E — metadata integrity. Each sub-case starts from a freshly bound page.
 background('bg-3');await resetPage();await enabled();
 state.summary.owner_alpha_background.policy_revision='bg-4';await refresh();await blocked(); // changed policy identity
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();background('bg-5');await open();await enabled();
 state.summary.owner_alpha_background.policy_expires_at=new Date(Date.now()+180000).toISOString();await refresh();await blocked(); // even an extended deadline is a change
 await resetPage();background('bg-5');await open();await enabled();
 state.summary.owner_alpha_background.schema_version=2;await refresh();await blocked(); // malformed
 await resetPage();background('bg-5');await open();await enabled();
 state.summary.owner_alpha_background.max_admissions=2;await refresh();await blocked(); // wrong finite count
 await resetPage();background('bg-5');await open();await enabled();
 delete state.summary.owner_alpha_background;await refresh();await blocked(); // missing custody after observing it
 const gD=gen();
 await resetPage();background('bg-6',{admissions_used:1,generation:gD,available:false});await open();await blocked();
 state.summary.owner_alpha_background.generation=gen();await refresh();await blocked(); // generation replacement
 await resetPage();background('bg-6',{admissions_used:1,generation:gD,available:false});await open();await blocked();
 state.summary.owner_alpha_background.generation=null;state.summary.owner_alpha_background.next_role=null;await refresh();await blocked(); // generation removal after binding
 await resetPage();background('bg-6',{admissions_used:1,generation:gD,available:false});await open();await blocked();
 state.summary.owner_alpha_background.admissions_used=0;await refresh();await blocked(); // count rollback
 assert.match(await banner(),/details changed or are unavailable/);
 await capture('changed-custody');
 // Phase F — impossible count/generation/role combinations fail closed on a fresh page.
 await resetPage();background('bg-7',{admissions_used:1,generation:null,available:true});await open();await blocked(); // count without generation
 await resetPage();background('bg-7',{admissions_used:0,generation:gen(),available:true});await open();await blocked(); // generation without first admission
 await resetPage();background('bg-7',{admissions_used:0,generation:null,available:true});await open();await enabled();
 state.summary.owner_alpha_background.next_role='status';await refresh();await blocked(); // status role before the first admission
 await resetPage();background('bg-7',{admissions_used:1,generation:gen(),available:true});await open();await enabled();
 state.summary.owner_alpha_background.next_role='independent';await refresh();await blocked(); // independent role at the wrong ordinal
 await resetPage();background('bg-7',{admissions_used:1,generation:gen(),available:false});await open();await blocked();
 state.summary.owner_alpha_background.next_role='status';await refresh();await blocked(); // a role while no admission is available
 await resetPage();background('bg-7',{admissions_used:4,generation:gen(),available:false});await open();await blocked(); // impossible count
 await resetPage();background('bg-8',{available:false});await open();await blocked(); // retained custody, no admission configured
 assert.match(await banner(),/No message admission is available in this background revision/);
 await capture('retained-unavailable');
 // Phase G — conflicting generation summaries fail closed rather than picking a permissive path.
 await resetPage();
 background('bg-9');
 state.summary.owner_alpha_warm={schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:'warm-conflict',persona_id:bot,
  policy_expires_at:new Date(Date.now()+120000).toISOString(),max_admissions:2,admissions_used:0,message_admission_available:true,next_role:'background',generation:null};
 await open();await blocked(); // background + warm present together
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();
 background('bg-9');
 state.summary.owner_alpha=true;
 state.summary.owner_alpha_session={persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_runs:2,admitted_runs:0,max_task_seconds:43};
 await open();await blocked(); // background + legacy session present together
 await resetPage();background('bg-session-only');
 state.summary.owner_alpha_session={persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_runs:2,admitted_runs:0,max_task_seconds:43};
 await open();await blocked(); // legacy custody conflicts even without the legacy mode flag
 await resetPage();background('bg-10');await open();await enabled();
 state.summary.owner_alpha_warm={schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:'warm-conflict-2',persona_id:bot,
  policy_expires_at:new Date(Date.now()+120000).toISOString(),max_admissions:2,admissions_used:0,message_admission_available:true,next_role:'background',generation:null};
 await refresh();await blocked(); // background-latched page where warm custody appears
 assert.match(await banner(),/details changed or are unavailable/);
 // Phase H — warm/legacy semantics unchanged without background custody.
 await resetPage();
 delete state.summary.owner_alpha;delete state.summary.owner_alpha_session;delete state.summary.owner_alpha_background;
 state.summary.owner_alpha_warm={schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:'warm-coexist',persona_id:bot,
  policy_expires_at:new Date(Date.now()+120000).toISOString(),max_admissions:2,admissions_used:0,message_admission_available:true,generation:null};
 await open();await enabled();
 assert.match(await banner(),/Warm owner generation/);
 await browser('fill','#message','Warm coexistence message');await browser('click','#send');await wait('document.querySelector("#message").value===""');await waitForCommands(5);assert.equal(commands.length,5);
 delete state.summary.owner_alpha_warm;
 background('bg-after-warm');await refresh();await blocked(); // no same-page successor from latched terminal warm custody
 // Phase I — offline blocks; reconnect restores the same bounded state.
 await resetPage();background('bg-11');await open();await enabled();
 offline=true;await evaluate('document.querySelector("#refresh").click()');await wait('document.querySelector("#connection").textContent==="Offline"');await blocked();
 assert.match(await banner(),/status is offline/);
 offline=false;await refresh();await wait('!document.querySelector("#send").disabled');
 // Phase J — uncertain send preserves pending bytes/key; explicit retry reuses the same key.
 await resetPage();background('bg-12');await open();await enabled();
 // The V5 durable outbox (ARCHITECTURE_V2 A5) retries automatically under the
 // same Idempotency-Key with backoff; there is no manual retry click, and
 // the composer clears immediately rather than holding the unsent text.
 failMessage=true;const beforeUncertain=commands.length;
 await browser('fill','#message','Uncertain background message');await browser('click','#send');
 await wait('document.querySelector(".outbox-status")?.textContent.includes("Not delivered")');
 await waitForCommands(beforeUncertain+1);
 const uncertainKey=commandKeys[beforeUncertain];
 let uncertainRecord=await outboxRecordFor(bot);
 assert.equal(uncertainRecord?.text,'Uncertain background message');assert.equal(uncertainRecord?.nonce,uncertainKey);assert.equal(uncertainRecord?.phase,'unknown');
 assert.equal(await evaluate('document.querySelector("#message").value'),'','the composer clears immediately; the unsent text lives only in the optimistic outbox bubble');
 failMessage=false;background('bg-12',{admissions_used:1,generation:gen(),available:true});
 await waitForCommands(beforeUncertain+2,15000); // the outbox's own backoff retries automatically, no click needed
 assert.ok(commandKeys.slice(beforeUncertain).every(k=>k===uncertainKey),'automatic retry reuses the same Idempotency-Key, no replay with a fresh key');
 assert.deepEqual(commands.at(-1).payload,{conversation_id:bot,text:'Uncertain background message'});
 await refresh();await enabled();
 // Draft survives a blocked generation and reload restores it.
 await evaluate(`document.querySelector("#message").value="Preserved background draft";document.querySelector("#message").dispatchEvent(new Event("input"))`);
 assert.equal(await evaluate(`localStorage.getItem('personal.draft.${bot}')`),'Preserved background draft');
 background('bg-12',{admissions_used:3,generation:state.summary.owner_alpha_background.generation,available:false});await refresh();
 assert.equal(await evaluate('document.querySelector("#send").disabled'),true);
 assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved background draft');
 {const n=commands.length;await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);}
 await open();assert.equal(await evaluate('document.querySelector("#send").disabled'),true);assert.equal(await evaluate('document.querySelector("#message").readOnly'),true);assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved background draft');
 {const n=commands.length;await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);}
 await capture('draft-preserved');
 // Phase K — a present owner_alpha_background property with a malformed value
 // (null, false, 0, '') latches background mode and fails closed; only a truly
 // absent property keeps legacy/default behavior. Fresh page for each value.
 for(const malformed of [null,false,0,'']){
  await resetPage();
  state.summary.owner_alpha_background=malformed;
  const beforeBotReads=botReads;
  await open();await blocked();
  assert.match(await banner(),/details changed or are unavailable/);
  assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);
  assert.equal(await evaluate('document.querySelector("#review-alpha-session").hidden'),true);
  assert.equal(commands.length,7);
  assert.equal(botReads,beforeBotReads,`no conversation reads while unbound for value ${JSON.stringify(malformed)}`);
  assert.equal(deniedReads,0);
  if(malformed===null)await capture('malformed-background-value');
 }
 // Phase L — timestamps must be contract-shaped UTC strings; non-string
 // values (9999) or wrong-shaped strings ('9999') are malformed.
 await resetPage();background('bg-13');state.summary.owner_alpha_background.policy_expires_at=9999;await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();background('bg-13',{admissions_used:1,generation:gen()});state.summary.owner_alpha_background.generation.expires_at=9999;await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();background('bg-13');state.summary.owner_alpha_background.policy_expires_at='9999';await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 // Phase M — first-observed generation/count inconsistency blocks in the same
 // backgroundBlock invocation on a fresh page, not on a later render.
 await resetPage();background('bg-14',{admissions_used:0,generation:gen()});await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();background('bg-14',{admissions_used:1,generation:null});await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 // Phase N — policy expiry fires on the local timer with zero network, and stays closed.
 await resetPage();background('bg-15',{policyTtl:2500});await open();await enabled();
 const beforePolicy=reads;await wait('document.querySelector("#runtime-banner-text").textContent.includes("Background policy expired")');
 assert.equal(reads,beforePolicy);await blocked();await capture('policy-expired');
 await rollbackClock();await refresh();await blocked(); // in-page clock rollback cannot reopen
 assert.match(await banner(),/Background policy expired/);await restoreClock();
 await open();await blocked(); // real clock after reload: still closed
 await rollbackClock();await refresh();await blocked(); // rolled-back clock after reload cannot reopen the sticky terminal state
 assert.match(await banner(),/Background policy expired/);await restoreClock();
 // Phase O — generation expiry is an independent ceiling with its own no-network timer.
 await resetPage();background('bg-16',{admissions_used:1,generation:gen(2500),available:true,policyTtl:120000});await open();await enabled();
 const beforeGeneration=reads;await wait('document.querySelector("#runtime-banner-text").textContent.includes("Background generation expired")');
 assert.equal(reads,beforeGeneration);await blocked();await capture('generation-expired');
 await rollbackClock();await refresh();await blocked(); // in-page rollback
 await open();await blocked();await rollbackClock();await refresh();await blocked(); // rollback after reload
 assert.match(await banner(),/Background generation expired/);await restoreClock();
 // Final accounting: every command was an explicit owner action; reads never wrote.
 assert.equal(commands.length,7);
 assert.ok(commands.every(c=>c.type==='message.send'));
 assert.equal(deniedReads,0);
 console.log('PASS background portal: pre-first A availability, S blocked until coordinator release and available with the generation live, B blocked until S settles and available, exhaustion with reload persistence, wrong persona/room read-only with zero denied reads, changed policy identity/deadline and generation replacement/removal, count rollback, impossible count/generation/role combinations, retained custody, conflicting warm/legacy custody fails closed, warm-only coexistence unchanged, offline/reconnect, draft and uncertain pending preservation with same-key retry, present-but-malformed background values fail closed with zero conversation reads, strict contract string timestamps, same-invocation first-observed inconsistency block, and independent policy/generation no-network expiry with in-page and cross-reload clock-rollback resistance, with zero passive commands and only explicit Sends.');
}catch(error){
 console.error((await browser('errors').catch(()=>({stdout:'Browser diagnostics unavailable'}))).stdout);
 console.error(await evaluate('({connection:document.querySelector("#connection")?.textContent,error:document.querySelector("#error")?.textContent,banner:document.querySelector("#runtime-banner-text")?.textContent,send:document.querySelector("#send")?.disabled})').catch(()=>null));
 throw error;
}finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
