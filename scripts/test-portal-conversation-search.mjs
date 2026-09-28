#!/usr/bin/env node
// Real Chromium DOM, synthetic read-only responses, no polling to mask added requests.
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const alpha='11111111-1111-4111-8111-111111111111',beta='22222222-2222-4222-8222-222222222222';
const hostile='<img src="/injected" onerror="window.searchExecuted=true">';
const message=(owner,sequence,text,type='message.user')=>({id:String(sequence),conversation_id:owner,sequence,type,payload:{text,status:'completed'},created_at:'2026-09-16T01:00:00.000Z'});
let recent=Array.from({length:100},(_,i)=>message(alpha,i+101,i===6?'Train 71':i===28?'TRAIN result 103':i===40?hostile:`Filler ${i}`,i===28?'run.result':'message.user'));
let floor=0,hold=false,release;
const requests=[],session=`conv-${randomUUID().slice(0,8)}`;
const state={objects:[{id:alpha,kind:'persona',revision:1,body:{name:'Alpha'}},{id:beta,kind:'persona',revision:1,body:{name:'Beta'}},{id:'room',kind:'room',revision:1,body:{name:'Shared room'}}],runs:[{id:'task',persona_id:alpha,role:'background',status:'running',current_attempt:1,title:'Keep task visible'}],questions:[{id:'question',conversation_id:alpha,persona_id:alpha,run_id:'task',attempt:1,revision:1,state:'pending',answerable:true,created_at:'2026-09-16T01:00:00Z',expires_at:'2026-09-16T02:00:00Z',params:{questions:[{header:'Choose',question:'Unmatched unresolved question',id:'q'}]}}],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const evaluate=async code=>JSON.parse((await browser('eval',code)).stdout);
const wait=code=>browser('wait','--fn',code);
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 // ARCHITECTURE_V2 A6: the portal always attempts a same-origin WebSocket at /v1/stream.
 // This fixture is plain HTTP with no upgrade handling, so answer with 426 and keep it
 // out of the request log the assertions below check — it is not one of the reads under test.
 if(url.pathname==='/v1/stream'){res.writeHead(426);return res.end();}
 requests.push(`${req.method} ${url.pathname}${url.search}`);
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/v1/state')return json(state);
 if(url.pathname.endsWith('/tasks')||url.pathname.endsWith('/recovery'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
 if(url.pathname.endsWith('/events')){
  if(url.searchParams.has('before')){
   const reply=()=>json({events:[message(alpha,19,'Older train 43')],pruned_through:0});
   if(hold){release=reply;return;}return reply();
  }
  const events=url.pathname.includes(alpha)?[...recent,{...message(alpha,201,''),type:'run.input_expired'}]:url.pathname.includes(beta)?[message(beta,301,'Beta train 997')]:[message('room',401,'Room ferry 23')];
  return json({events,pruned_through:url.pathname.includes(alpha)?floor:0});
 }
 const file=portalFiles[url.pathname];
 if(!file){res.writeHead(404);res.end();return;}
 let content=await portalFile(file,'utf8');
 if(file==='index.html')content=content.replace('<head>','<head><script>window.setInterval=()=>0;</script>');
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(content);
});
const texts=()=>evaluate('Array.from(document.querySelectorAll("article.message .message-body"),e=>e.textContent)');
const search=async(value,expected)=>{const count=requests.length;await browser('fill','#conversation-search',value);assert.deepEqual(await texts(),expected);assert.equal(requests.length,count,'zero search requests');};
const clickText=text=>browser('eval',`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
let revision=0;
const refresh=async(selector='#refresh',owner=alpha)=>{
 state.provider={id:`refresh-${++revision}`};const count=requests.length;
 await browser('click',selector);await wait(`document.querySelector('#runtime-provider').textContent===${JSON.stringify(state.provider.id)}`);
 assert.deepEqual(requests.slice(count),['GET /v1/state',`GET /v1/conversations/${owner}/events`,`GET /v1/conversations/${owner}/tasks`]);
};
const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);
const capture=async name=>{
 await browser('eval','document.querySelector("#timeline").scrollTo({top:0,behavior:"instant"})');
 if(name.includes('matched')||name.includes('narrow'))await browser('eval','document.querySelector("article.message").scrollIntoView({block:"start",behavior:"instant"})');
 await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 assert.equal(await evaluate('devicePixelRatio'),2);
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await browser('screenshot',decodeURIComponent(new URL(name,artifacts).pathname));
};
try{
 await mkdir(artifacts,{recursive:true});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','1000','2');
 await wait('document.querySelector("#connection").textContent==="Connected"');
 await browser('click','#conversation-search-panel > summary');
 assert.equal(await evaluate('document.querySelector("#conversation-search").labels[0].textContent'),'Search message text');
 assert.equal(await evaluate('document.querySelector("#conversation-search").maxLength'),200);
 assert.equal(await evaluate('document.querySelector("#conversation-search-status").getAttribute("role")'),'status');
 await search('  TrAiN  ',['Train 71','TRAIN result 103']);
 // run.result is a notice, not a search-filtered bubble (ARCHITECTURE_V2 A7): the "N of M
 // loaded messages" count only covers message.user/bot.message, so the run.result event
 // among `recent` (rendered separately, via its own always-shown notice plus a legacy-text
 // bot article) is excluded from both the denominator and this count's numerator.
 assert.equal(await evaluate('document.querySelector("#conversation-search-status").textContent'),'1 of 99 loaded messages shown.');
 await browser('click','#conversation-search-panel details > summary');
 assert.match((await browser('get','text','#conversation-search-help')).stdout,/Only loaded sent messages/);
 await browser('click','#conversation-search-panel details > summary');
 await capture('portal-conversation-search-matched.png');
 const count=requests.length;
 await browser('focus','#conversation-search');await browser('press','Tab');assert.equal(await evaluate('document.activeElement.id'),'clear-conversation-search');
 await browser('press','Enter');assert.equal((await texts()).length,100);assert.equal(await evaluate('document.activeElement.id'),'conversation-search');assert.equal(requests.length,count);
 await search('   ',recent.map(e=>e.payload.text));
 await search('.*',[]);await search('Beta train',[]);await search('Keep task visible',[]);
 assert.equal(await evaluate('document.querySelectorAll(".question-card").length'),1);
 assert.equal(await evaluate('!!document.querySelector("[data-run-id=task]")'),true);
 assert.match((await browser('get','text','#timeline')).stdout,/Review and answer/);
 await browser('click','[data-run-id=task] > summary');
 assert.match((await browser('get','text','#timeline')).stdout,/Cancel this task/);
 assert.match((await browser('get','text','#timeline')).stdout,/Request expired/);
 assert.equal(await evaluate('document.querySelector("#runtime-banner").hidden'),false);
 await capture('portal-conversation-search-empty.png');
 await search(hostile,[hostile]);assert.equal(await evaluate('document.querySelectorAll("#timeline img").length'),0);assert.equal(await evaluate('window.searchExecuted===true'),false);
 await search('older',[]);const before=requests.length;await clickText('Load earlier messages');
 await wait('document.querySelector("article.message .message-body")?.textContent==="Older train 43"');
 assert.deepEqual(requests.slice(before),[`GET /v1/conversations/${alpha}/events?before=101`]);
 await search('train',['Older train 43','Train 71','TRAIN result 103']);
 await refresh();assert.equal(await evaluate('document.querySelector("#conversation-search").value'),'train');
 recent.push(message(alpha,202,'New train 811'));await refresh();assert.deepEqual(await texts(),['Older train 43','Train 71','TRAIN result 103','New train 811']);
 hold=true;await clickText('Load earlier messages');assert.ok(release);
 floor=200;recent=recent.filter(e=>e.sequence>floor);await refresh();assert.deepEqual(await texts(),['New train 811']);
 release();await wait('performance.getEntriesByType("resource").some(e=>e.name.endsWith("events?before=19"))');
 await browser('eval','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.deepEqual(await texts(),['New train 811']);
 assert.match((await browser('get','text','#timeline')).stdout,/Earlier history has expired/);
 floor=202;recent=[];await refresh();assert.deepEqual(await texts(),[]);
 assert.equal(await evaluate('document.querySelector("#conversation-search-status").textContent'),'0 of 0 loaded messages shown. No loaded messages match.');
 await refresh(`[data-persona-id="${beta}"]`,beta);assert.equal(await evaluate('document.querySelector("#conversation-search").value'),'');assert.deepEqual(await texts(),['Beta train 997']);
 await search('TRAIN',['Beta train 997']);await browser('set','viewport','390','1100','2');await capture('portal-conversation-search-narrow.png');
 await browser('click','#conversation-search-panel > summary');await browser('set','viewport','390','844','2');await capture('portal-conversation-search-narrow-collapsed.png');
 assert.match((await browser('get','text','#conversation-search-panel > summary')).stdout,/Filter active \(1\/1\)/);
 assert.deepEqual(await texts(),['Beta train 997']);await browser('click','#conversation-search-panel > summary');
 await browser('set','viewport','1280','1000','2');
 await refresh('#rooms button','room');assert.equal(await evaluate('document.querySelector("#conversation-search").value'),'');await search('train',[]);
 await clickText('Review recovery tasks');await wait('document.querySelector("#timeline").textContent.includes("No recovery tasks")');assert.equal(await evaluate('document.querySelector("#conversation-search-panel").hidden'),true);
 await clickText('Back to messages');assert.equal(await evaluate('document.querySelector("#conversation-search").value'),'');assert.deepEqual(await texts(),['Room ferry 23']);
 await browser('click','#show-skills');await wait('document.querySelector("#conversation-name").textContent==="Skills"');assert.equal(await evaluate('document.querySelector("#conversation-search-panel").hidden'),true);
 await refresh(`[data-persona-id="${beta}"]`,beta);assert.equal(await evaluate('document.querySelector("#conversation-search").value'),'');
 assert.equal(requests.some(r=>!r.startsWith('GET ')),false);
 assert.equal(requests.some(r=>/source|injected|inference/.test(r)),false);
 console.log('PASS: asymmetric bot/room scopes; user/result text only; bounded literal case-insensitive search; hostile text; label/live counts/keyboard clear; zero added search requests.');
 console.log('PASS: questions, task cancel controls and safety notices remain; pagination before=101 independent of zero matches; refresh/new text; retention/deletion and delayed pre-floor reply rejection; bot/room/recovery/Skills resets.');
 console.log('PASS: matched, empty and narrow Chromium DPR2 captures; no horizontal overflow; no mutations, source retrieval or inference.');
}finally{await browser('close');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
