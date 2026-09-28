#!/usr/bin/env node
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const session=`schedule-${randomUUID().slice(0,8)}`,bot=randomUUID(),trigger=randomUUID(),policy=randomUUID();
const browser=(...args)=>promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000});
const click=name=>browser('find','role','button','click','--name',name,'--exact'),wait=fn=>browser('wait','--fn',fn),evaluate=async fn=>JSON.parse((await browser('eval',fn)).stdout);
const select=(name,value)=>browser('select',`[name="${name}"]`,value),fill=(name,value)=>browser('fill',`[name="${name}"]`,value);
const clickSelector=async selector=>{await browser('eval',`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await browser('click',selector);};
const base={persona_id:bot,instructions:'Synthetic instructions',enabled:false,policy:{misfire:'skip',overlap:'skip',max_replay:2,max_lateness_seconds:60},action_policy_ids:[policy]};
const custom={id:randomUUID(),revision:3,kind:'routine',body:{...base,name:'Custom schedule',schedule:{cron:'5,35 7-19 * * 1,3,5',timezone:'Asia/Singapore'},trigger_source_id:null}};
const event={id:randomUUID(),revision:4,kind:'routine',body:{...base,name:'Event monitor',schedule:null,trigger_source_id:trigger}};
const state={objects:[{id:bot,kind:'persona',body:{name:'Travel'}},custom,event],settings:{timezone:'Asia/Jakarta'},runs:[],summary:{phase:'STOPPED',execution_enabled:false,queued_runs:0,blocked_runs:0}};
const commands=[],previews=[];let delay=null;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://fixture'),path=url.pathname,json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/v1/commands'){
   let raw='';for await(const chunk of req)raw+=chunk;const command=JSON.parse(raw);assert.equal(command.type,'routine.put');commands.push(command);
   return json({id:randomUUID(),status:'applied'});
  }
  assert.equal(req.method,'GET');if(path==='/v1/state')return json(state);
  if(path==='/v1/schedules/preview'){
   const schedule={cron:url.searchParams.get('cron'),timezone:url.searchParams.get('timezone')};previews.push(schedule);
   const allowed=['0 8 * * 1-5|Asia/Jakarta','17 23 * * 2|Asia/Jakarta','*/30 * * * *|Asia/Jakarta','5,35 7-19 * * 1,3,5|Asia/Singapore'];
   if(!allowed.includes(`${schedule.cron}|${schedule.timezone}`)){res.writeHead(422,{'content-type':'application/json'});res.end('{"error":{"message":"The cron expression or timezone is invalid."}}');return;}
   const next_times=schedule.cron==='17 23 * * 2'?['2026-09-15T16:17:00.000Z','2026-09-22T16:17:00.000Z','2026-09-29T16:17:00.000Z']:schedule.cron==='*/30 * * * *'?['2026-09-14T00:30:00.000Z','2026-09-14T01:00:00.000Z','2026-09-14T01:30:00.000Z']:schedule.cron.startsWith('5,35')?['2026-09-14T00:05:00.000Z','2026-09-14T00:35:00.000Z','2026-09-14T01:05:00.000Z']:['2026-09-14T01:00:00.000Z','2026-09-15T01:00:00.000Z','2026-09-16T01:00:00.000Z'];
   if(delay){const held=delay;delay=null;held.arrived();await new Promise(ok=>held.release=ok);}
   return json({schedule,observed_at:'2026-09-14T00:00:00.000Z',next_times});
  }
  if(path.endsWith('/tasks'))return json({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
  if(path.startsWith('/v1/conversations/'))return json({events:[],has_more:false,pruned_through:0});
  const file=portalFiles[path];if(!file){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await portalFile(file));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const artifacts=new URL('../.amp/in/artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
const capture=name=>browser('screenshot',decodeURIComponent(new URL(`portal-schedule-${name}.png`,artifacts).pathname));
const preview=async()=>{await clickSelector('.schedule-picker button');await wait('document.querySelectorAll("#schedule-preview li").length===3');};
const save=async()=>{await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor").open');};
try{
 await browser('open',`http://127.0.0.1:${server.address().port}/?view=detailed`);await browser('set','viewport','1280','900','2');await wait('document.querySelector("#connection").textContent==="Connected"');await clickSelector('#add-routine');
 assert.equal(await evaluate('document.querySelector("[name=frequency]").value'),'weekdays');assert.equal(await evaluate('document.querySelector("[name=timezone]").value'),'Asia/Jakarta');
 assert.equal(await evaluate('document.querySelector("[name=cron]").disabled'),true);await fill('name','Weekly review');await fill('instructions','Synthetic owner instructions');await select('enabled','false');
 await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,0);
 await select('frequency','weekly');
 // Chromium's segmented time widget is not supported by agent-browser fill.
 await browser('eval','{const input=document.querySelector("[name=local-time]");input.value="23:17";input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}');
 await select('weekday','2');await preview();assert.deepEqual(previews.at(-1),{cron:'17 23 * * 2',timezone:'Asia/Jakarta'});
 await browser('eval','document.querySelector("[name=frequency]").scrollIntoView({behavior:"instant",block:"start"})');await capture('weekly');
 await save();assert.deepEqual(commands[0].payload.schedule,previews.at(-1));assert.equal(commands[0].payload.enabled,false);assert.deepEqual(commands[0].payload.action_policy_ids,[]);
 await clickSelector('#routines .card:first-child button');assert.equal(await evaluate('document.querySelector("[name=frequency]").value'),'advanced');assert.equal(await evaluate('document.querySelector("[name=timezone]").value'),'Asia/Singapore');
 assert.match((await browser('get','text','#editor')).stdout,/not the installation default/);await preview();await save();assert.deepEqual(commands[1].payload.schedule,custom.body.schedule);assert.deepEqual(commands[1].payload.policy,base.policy);assert.deepEqual(commands[1].payload.action_policy_ids,[policy]);
 const previous=previews.length;await clickSelector('#routines .card:nth-child(2) button');assert.equal(await evaluate('document.querySelector(".schedule-picker")===null'),true);await fill('name','Renamed event monitor');await save();assert.equal(previews.length,previous);assert.equal(commands[2].payload.trigger_source_id,trigger);assert.equal(commands[2].payload.schedule,null);
 await clickSelector('#add-routine');await fill('name','Interval');await fill('instructions','Read only');await select('frequency','30');await preview();await select('frequency','advanced');await fill('cron','* * * * *');await clickSelector('.schedule-picker button');await wait('document.querySelector("#schedule-preview").textContent.includes("invalid")');
 await browser('eval','document.querySelector("#schedule-preview").scrollIntoView({behavior:"instant",block:"end"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await capture('invalid');assert.equal(await evaluate('document.querySelectorAll("#schedule-preview li").length'),0);
 await clickSelector('#editor-form button[type=submit]');await wait('!document.querySelector("#editor-error").hidden');assert.equal(commands.length,3);
 let arrived;const held={arrived:()=>arrived()};delay=held;const arrival=new Promise(ok=>arrived=ok);await select('frequency','weekdays');await clickSelector('.schedule-picker button');await arrival;await select('frequency','30');held.release();await wait('document.querySelector("#schedule-preview").textContent.includes("before saving")');assert.equal(await evaluate('document.querySelectorAll("#schedule-preview li").length'),0);
 await clickSelector('#editor-form button[type=submit]');assert.equal(commands.length,3);await preview();
 await browser('set','viewport','390','844','2');await browser('eval','document.querySelector("#schedule-preview").scrollIntoView({behavior:"instant",block:"end"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await capture('narrow');await save();assert.deepEqual(commands[3].payload.schedule,{cron:'*/30 * * * *',timezone:'Asia/Jakarta'});
 assert.equal(commands.length,4);console.log('PASS: picker defaults/weekly/interval, reviewed preview-save equality, invalid and late previews cannot authorize Save, custom timezone/cron/policy preserved, event trigger preserved, narrow editor; four explicit routine.put mutations only.');
}catch(error){console.error('Fixture failure:',JSON.stringify(previews),(await browser('get','text','#schedule-preview')).stdout.trim());throw error;}
finally{if(delay?.release)delay.release();await browser('close').catch(()=>{});server.closeAllConnections();await new Promise(ok=>server.close(ok));}
