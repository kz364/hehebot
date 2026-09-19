#!/usr/bin/env node
// Synthetic warm-generation browser fixtures only; no model, account, provider
// or gateway calls. Verifies the portal's strict summary.owner_alpha_warm path:
// pre-first availability, first-message generation start, same-generation second
// admission after canonical completion, exhaustion, both immutable deadlines
// with no-network timers, read-only other personas/rooms, metadata integrity,
// offline/reconnect, draft/pending preservation, and zero passive commands.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const bot=randomUUID(),other=randomUUID(),room=randomUUID(),session='warm-alpha-portal';
const state={objects:[{id:bot,kind:'persona',revision:1,body:{name:'Travel'}},{id:other,kind:'persona',revision:1,body:{name:'Inbox'}},{id:room,kind:'room',revision:1,body:{name:'Planning room'}}],runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const commands=[],commandKeys=[];
const gen=(ttl=60000)=>({session_id:randomUUID(),expires_at:new Date(Date.now()+ttl).toISOString(),epoch:2});
const policyDeadlines=new Map();
const warm=(revision,{admissions_used=0,generation=null,available=true,policyTtl=120000}={})=>{
 if(!policyDeadlines.has(revision))policyDeadlines.set(revision,new Date(Date.now()+policyTtl).toISOString());
 state.summary.owner_alpha_warm={schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:revision,persona_id:bot,
  policy_expires_at:policyDeadlines.get(revision),max_admissions:2,admissions_used,message_admission_available:available,generation};
 delete state.summary.owner_alpha;delete state.summary.owner_alpha_session;delete state.summary.owner_alpha_bootstrap;
};
let reads=0,deniedReads=0,botReads=0,offline=false,failMessage=false;
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const server=createServer(async(req,res)=>{
 const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/v1/commands'){let raw='';for await(const part of req)raw+=part;commands.push(JSON.parse(raw));commandKeys.push(req.headers['idempotency-key']);return failMessage?json({error:{message:'Synthetic lost response'}},503):json({status:'applied'});}
 if(path==='/v1/state'){reads++;return json(offline?{error:{message:'Synthetic offline'}}:state,offline?503:200);}
 if(path.startsWith(`/v1/conversations/${bot}/`))botReads++;
 if(state.summary.owner_alpha_warm&&path.startsWith('/v1/conversations/')&&!path.startsWith(`/v1/conversations/${bot}/`)){deniedReads++;return json({error:{message:'Conversation unavailable in warm generation'}},403);}
 if(path.endsWith('/events'))return json({events:[{sequence:1,conversation_id:bot,type:'message.user',created_at:new Date().toISOString(),payload:{text:'Retained synthetic history'}}]});
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
const capture=async name=>{await browser('set','viewport','1280','1200','2');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',new URL(`portal-alpha-warm-${name}.png`,artifacts).pathname);await browser('set','viewport','1280','900','2');};
const narrowCapture=async name=>{await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('devicePixelRatio'),2);await browser('screenshot',new URL(`portal-alpha-warm-${name}.png`,artifacts).pathname);};
const resetPage=async()=>{await evaluate('sessionStorage.clear()');await open();};
try{
 // Phase 0 — ordinary default mode before any warm summary.
 await open();await enabled();
 await browser('fill','#message','Ordinary saved message');await browser('click','#send');await wait('document.querySelector("#message").value===""');assert.equal(commands.length,1);
 // Phase A — pre-first availability: two of two, generation:null, passive reads send nothing.
 warm('warm-1');await refresh();await enabled();
 assert.match(await banner(),/2 of 2 messages remaining/);assert.match(await banner(),/One fixed generation starts with your first Send/);
 assert.match(await banner(),/not always-on chat/);assert.match(await banner(),/No renewal, rollover, successor generation or background work/);
 assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true); // legacy alpha restrictions apply
 await passive(1);await capture('pre-first');
 await browser('set','viewport','390','844','2');await browser('screenshot',new URL('portal-alpha-warm-pre-first-narrow.png',artifacts).pathname);await browser('set','viewport','1280','900','2');
 // Phase B — first message starts the generation; unavailable while the first task runs;
 // canonical completion reopens the SECOND admission in the SAME generation; then exhaustion.
 await browser('fill','#message','Warm first message');await browser('click','#send');await wait('document.querySelector("#message").value===""');assert.equal(commands.length,2);
 const generation=gen();warm('warm-1',{admissions_used:1,generation,available:false}); // first task not canonically complete
 await refresh();await blocked();
 assert.match(await banner(),/No message admission is available in this warm revision/);assert.match(await banner(),/1 of 2 messages remaining/);assert.match(await banner(),/Generation 2 deadline/);
 state.summary.owner_alpha_warm.message_admission_available=true; // canonical completion observed server-side
 await refresh();await enabled();
 assert.match(await banner(),/1 of 2 messages remaining/);assert.match(await banner(),/second message reuses this generation only after the first task completes canonically/);
 await browser('fill','#message','Warm second message');await browser('click','#send');await wait('document.querySelector("#message").value===""');assert.equal(commands.length,3);
 warm('warm-1',{admissions_used:2,generation,available:false});
 await refresh();await blocked();assert.match(await banner(),/Both warm messages have been used/);assert.match(await banner(),/0 of 2 messages remaining/);
 await capture('exhausted');
 await resetPage();await blocked(); // durable exhaustion survives reload
 await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,3);
 // Phase C — other personas and rooms are read-only; no denied conversation reads.
 await resetPage();warm('warm-2');await open();await enabled();
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);await blocked();
 assert.match(await banner(),/only for its selected persona/);
 assert.match(await evaluate('document.querySelector("#timeline").textContent'),/History and task pages are unavailable/);
 await evaluate('document.querySelector("#rooms button").click()');await blocked();
 assert.equal(deniedReads,0);
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);await wait('!document.querySelector("#send").disabled');await capture('wrong-persona-restored');
 // Phase D — metadata integrity. Each sub-case starts from a freshly bound page.
 warm('warm-2');await refresh();await enabled();
 state.summary.owner_alpha_warm.policy_revision='warm-3';await refresh();await blocked(); // changed identity/policy
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();warm('warm-4');await open();await enabled();
 state.summary.owner_alpha_warm.policy_expires_at=new Date(Date.now()+180000).toISOString();await refresh();await blocked(); // even an extended immutable deadline is a change
 await resetPage();warm('warm-4');await open();await enabled();
 state.summary.owner_alpha_warm.schema_version=2;await refresh();await blocked(); // malformed
 await resetPage();warm('warm-4');await open();await enabled();
 delete state.summary.owner_alpha_warm;await refresh();await blocked(); // missing
 const gD=gen();await resetPage();warm('warm-5',{admissions_used:1,generation:gD,available:true});await open();await enabled();
 state.summary.owner_alpha_warm.generation=gen();await refresh();await blocked(); // generation replacement
 await resetPage();warm('warm-5',{admissions_used:1,generation:gD,available:true});await open();await enabled();
 state.summary.owner_alpha_warm.generation=null;await refresh();await blocked(); // generation removal after binding
 await resetPage();warm('warm-5',{admissions_used:1,generation:gD,available:true});await open();await enabled();
 state.summary.owner_alpha_warm.admissions_used=0;await refresh();await blocked(); // count rollback
 await resetPage();warm('warm-5',{admissions_used:1,generation:gD,available:false});await open();await blocked(); // retained custody, config removed
 assert.match(await banner(),/No message admission is available in this warm revision/);
 await capture('retained-unavailable');
 // Phase E — offline blocks; reconnect restores the same bounded state.
 await resetPage();warm('warm-6');await open();await enabled();
 offline=true;await evaluate('document.querySelector("#refresh").click()');await wait('document.querySelector("#connection").textContent==="Offline"');await blocked();
 assert.match(await banner(),/status is offline/);
 offline=false;await refresh();await wait('!document.querySelector("#send").disabled');
 // Phase F — policy expiry fires on the local timer with zero network, and stays closed.
 await resetPage();warm('warm-7',{policyTtl:2500});await open();await enabled();
 const beforePolicy=reads;await wait('document.querySelector("#runtime-banner-text").textContent.includes("Warm policy expired")');
 assert.equal(reads,beforePolicy);await blocked();await capture('policy-expired');
 await rollbackClock();await refresh();await blocked(); // in-page clock rollback cannot reopen
 assert.match(await banner(),/Warm policy expired/);await restoreClock();
 await open();await blocked(); // real clock after reload: still closed
 await rollbackClock();await refresh();await blocked(); // rolled-back clock after reload cannot reopen the sticky terminal state
 assert.match(await banner(),/Warm policy expired/);await restoreClock();
 // Phase G — generation expiry is an independent ceiling with its own no-network timer.
 await resetPage();warm('warm-8',{admissions_used:1,generation:gen(2500),available:true,policyTtl:120000});await open();await enabled();
 const beforeGeneration=reads;await wait('document.querySelector("#runtime-banner-text").textContent.includes("Warm generation expired")');
 assert.equal(reads,beforeGeneration);await blocked();await capture('generation-expired');
 await rollbackClock();await refresh();await blocked(); // in-page rollback
 await open();await blocked();await rollbackClock();await refresh();await blocked(); // rollback after reload
 assert.match(await banner(),/Warm generation expired/);await restoreClock();
 // Phase H — drafts and uncertain pending bytes/keys are preserved; explicit retry reuses the key.
 await resetPage();warm('warm-9');await open();await enabled();
 failMessage=true;await browser('fill','#message','Uncertain warm message');await browser('click','#send');
 await wait('document.querySelector("#draft-status").textContent.includes("Not confirmed")');
 const pending=await evaluate(`localStorage.getItem('personal.pending.${bot}')`);
 assert.equal(JSON.parse(pending).text,'Uncertain warm message');
 failMessage=false;warm('warm-9',{admissions_used:1,generation:gen(),available:true});await refresh();await enabled();
 await browser('click','#send');await wait('document.querySelector("#message").value===""');assert.equal(commands.length,5);
 assert.equal(commandKeys.at(-1),JSON.parse(pending).key); // same idempotency key, no replay with a fresh key
 assert.deepEqual(commands.at(-1).payload,{conversation_id:bot,text:'Uncertain warm message'});
 // Draft survives a blocked generation and reload restores it.
 await evaluate(`document.querySelector("#message").value="Preserved warm draft";document.querySelector("#message").dispatchEvent(new Event("input"))`);
 assert.equal(await evaluate(`localStorage.getItem('personal.draft.${bot}')`),'Preserved warm draft');
 warm('warm-9',{admissions_used:2,generation:state.summary.owner_alpha_warm.generation,available:false});await refresh();
 assert.equal(await evaluate('document.querySelector("#send").disabled'),true);
 assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved warm draft');
 {const n=commands.length;await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);}
 await open();assert.equal(await evaluate('document.querySelector("#send").disabled'),true);assert.equal(await evaluate('document.querySelector("#message").readOnly'),true);assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved warm draft');
 {const n=commands.length;await evaluate('document.querySelector("#composer").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(commands.length,n);assert.equal(await evaluate('document.querySelector("#message").value'),'Preserved warm draft');}
 await capture('draft-preserved');
 // Phase I — a present owner_alpha_warm property with a malformed value
 // (null, false, 0, '') latches warm mode and fails closed; only a truly
 // absent property keeps legacy/default behavior. Fresh page for each value.
 for(const malformed of [null,false,0,'']){
  await resetPage();
  state.summary.owner_alpha_warm=malformed;
  const beforeBotReads=botReads;
  await open();await blocked();
  assert.match(await banner(),/details changed or are unavailable/);
  assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);
  assert.equal(await evaluate('document.querySelector("#review-alpha-session").hidden'),true);
  assert.equal(commands.length,5);
  assert.equal(botReads,beforeBotReads,`no conversation reads while unbound for value ${JSON.stringify(malformed)}`);
  assert.equal(deniedReads,0);
  if(malformed===null)await capture('malformed-warm-value');
 }
 // Phase J — persona_id changed to a foreign persona after binding: the
 // foreign persona stays read-only, reads stay scoped to the validated bound
 // identity, and no legacy fallback persona is ever authorized.
 await resetPage();warm('warm-J');await open();await enabled();
 state.summary.owner_alpha_warm.persona_id=other;
 await refresh();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await evaluate(`document.querySelector('[data-persona-id="${other}"]').click()`);
 await blocked();
 assert.match(await evaluate('document.querySelector("#timeline").textContent'),/History and task pages are unavailable/);
 assert.equal(deniedReads,0,'changed foreign persona is never granted conversation reads');
 const boundReads=botReads;
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);
 await blocked();
 assert.ok(botReads>boundReads,'bound identity keeps its read scope after the metadata change');
 assert.equal(commands.length,5);
 // Phase K — malformed first summary (owner_alpha_warm=null) with a foreign
 // persona selected: zero conversation reads anywhere until a valid binding.
 await resetPage();
 state.summary.owner_alpha_warm=null;
 await evaluate(`localStorage.setItem('personal.selected','${other}')`);
 await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 assert.equal(await evaluate('document.querySelector("#show-connectors").hidden'),true);
 await evaluate(`document.querySelector('[data-persona-id="${bot}"]').click()`);
 await blocked();
 assert.equal(commands.length,5);
 await evaluate(`localStorage.removeItem('personal.selected')`);
 // Phase L — timestamps must be contract-shaped UTC strings; non-string
 // values (9999) or wrong-shaped strings ('9999') are malformed.
 await resetPage();warm('warm-L0');state.summary.owner_alpha_warm.policy_expires_at=9999;await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();warm('warm-L1',{admissions_used:1,generation:gen()});state.summary.owner_alpha_warm.generation.expires_at=9999;await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();warm('warm-L2');state.summary.owner_alpha_warm.policy_expires_at='9999';await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 // Phase M — first-observed generation/count inconsistency blocks in the same
 // warmBlock invocation on a fresh page, not on a later render.
 await resetPage();warm('warm-M1',{admissions_used:0,generation:gen()});await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 await resetPage();warm('warm-M2',{admissions_used:1,generation:null});await open();await blocked();
 assert.match(await banner(),/details changed or are unavailable/);
 // Phase N — legacy bootstrap adoption then transition to warm mode: the
 // review/renewal control hides when warm latches; pre-first admission opens.
 await resetPage();
 delete state.summary.owner_alpha_warm;
 state.summary.owner_alpha=true;
 state.summary.owner_alpha_session={persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_runs:2,admitted_runs:1,max_task_seconds:43};
 state.summary.owner_alpha_bootstrap={policy_revision:'synthetic-bootstrap-warm',persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_task_seconds:83,message_admission_available:true};
 await open();
 // The load-time bind reviews the first revision; adoption (like the legacy
 // suite) requires a fresh policy revision, which closes Send until reviewed.
 state.summary.owner_alpha_bootstrap={policy_revision:'synthetic-bootstrap-warm-2',persona_id:bot,expires_at:new Date(Date.now()+120000).toISOString(),max_task_seconds:83,message_admission_available:true};
 await refresh();await blocked();
 await wait('!document.querySelector("#review-alpha-session").disabled');
 await browser('click','#review-alpha-session');
 await wait('document.querySelector("#editor").open');
 await browser('check','#editor [name=confirm]');
 await browser('click','#editor-form button[type=submit]');
 await wait('!document.querySelector("#editor").open&&!document.querySelector("#send").disabled');
 assert.equal(await evaluate('document.querySelector("#review-alpha-session").hidden'),false);
 warm('warm-N');await refresh();
 assert.equal(await evaluate('document.querySelector("#review-alpha-session").hidden'),true,'legacy review/renewal control is hidden once warm latches');
 await enabled();
 assert.match(await banner(),/2 of 2 messages remaining/);
 assert.equal(commands.length,5,'bootstrap adoption and the warm transition send zero commands');
 // Phase O — narrow 390x844 viewport: measure whether scrolling makes the
 // composer reachable, then exercise a real Send and a blocked Send.
 await resetPage();warm('warm-O');await open();await enabled();
 await browser('set','viewport','390','844','2');
 const geometry=()=>evaluate(`(()=>{const s=document.querySelector('#send').getBoundingClientRect(),c=document.querySelector('#composer').getBoundingClientRect();return {sendTop:Math.round(s.top),sendBottom:Math.round(s.bottom),composerBottom:Math.round(c.bottom),innerHeight,scrollY:Math.round(scrollY),docScrollHeight:document.documentElement.scrollHeight}})()`);
 const beforeScroll=await geometry();
 await evaluate('document.querySelector("#composer").scrollIntoView({behavior:"instant",block:"end"})');
 const afterScroll=await geometry();
 console.log('narrow 390x844 composer geometry:',JSON.stringify({beforeScroll,afterScroll}));
 assert.ok(afterScroll.sendTop>=0&&afterScroll.sendBottom<=afterScroll.innerHeight,'narrow composer reachable after scroll: '+JSON.stringify({beforeScroll,afterScroll}));
 await narrowCapture('narrow-composer');
 await browser('fill','#message','Narrow viewport warm message');await browser('click','#send');
 await wait('document.querySelector("#message").value===""');assert.equal(commands.length,6);
 warm('warm-O',{admissions_used:2,generation:gen(),available:false});await refresh();
 await blocked();
 assert.match(await banner(),/Both warm messages have been used/);
 await evaluate('document.querySelector("#composer").scrollIntoView({behavior:"instant",block:"end"})');
 await narrowCapture('narrow-exhausted');
 await browser('set','viewport','1280','900','2');
 // Final accounting: every command was an explicit owner action; reads never wrote.
 assert.equal(commands.length,6);
 assert.ok(commands.every(c=>c.type==='message.send'));
 assert.equal(deniedReads,0);
 console.log('PASS warm portal: pre-first availability, first-starts-generation, same-generation second after canonical completion, exhaustion with reload persistence, wrong persona/room read-only with zero denied reads, malformed/missing/changed metadata, extended-deadline change, count rollback, generation replacement/removal, retained custody, offline/reconnect, independent policy and generation no-network expiry with in-page and cross-reload clock-rollback resistance, draft and uncertain pending preservation with same-key retry, zero passive commands and blocked programmatic submit, present-but-malformed warm values fail closed, changed persona keeps reads scoped to the bound identity with no legacy fallback, malformed first summary with foreign selection issues zero conversation reads, strict contract string timestamps, same-invocation first-observed generation/count inconsistency block, legacy bootstrap-to-warm transition hides the review control, and narrow-viewport composer reachability with a real Send and a blocked Send.');
}catch(error){
 console.error((await browser('errors').catch(()=>({stdout:'Browser diagnostics unavailable'}))).stdout);
 console.error(await evaluate('({connection:document.querySelector("#connection")?.textContent,error:document.querySelector("#error")?.textContent,banner:document.querySelector("#runtime-banner-text")?.textContent,send:document.querySelector("#send")?.disabled})').catch(()=>null));
 throw error;
}finally{await browser('close').catch(()=>{});await new Promise(ok=>server.close(ok));}
