import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createPreflightService} from '../runtime/sprites-service-entry.mjs';

const WAKE_TOKEN='wake-secret-marker-'.repeat(2);
const OWNER_A='a'.repeat(64);
const OWNER_B='b'.repeat(64);
const PRIVATE_MARKERS=[WAKE_TOKEN,OWNER_A,OWNER_B,'owner-secret-marker','hash-secret-marker'];

function deferred(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}

async function bounded(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${label}`)),1000);})]);}
 finally{clearTimeout(timer);}
}

async function withService({ownerBindingSha256=OWNER_A,control,report},run){
 const server=createPreflightService({port:8080,ownerBindingSha256},{control,report,privateFile:()=>WAKE_TOKEN});
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 try{await run(`http://127.0.0.1:${server.address().port}`);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

function wake(origin,token=WAKE_TOKEN){
 return fetch(`${origin}/wake`,{method:'POST',headers:{'content-type':'application/json','x-hehe-wake-token':token},body:JSON.stringify({epoch:7,operationId:randomUUID()})});
}

function assertSanitized(reports){
 const output=JSON.stringify(reports);
 for(const marker of PRIVATE_MARKERS)assert.equal(output.includes(marker),false,`report exposed private marker`);
}

test('real HTTP wake accepts before status completes and matching owner binding reports transport-only readiness',async()=>{
 const status=deferred(),reported=deferred(),calls=[],reports=[];
 const control={request:(name,payload)=>{calls.push([name,payload]);return status.promise;}};
 await withService({control,report:value=>{reports.push(value);reported.resolve(value);}},async origin=>{
  const response=await bounded(wake(origin),'HTTP wake response');
  assert.equal(response.status,202);
  assert.deepEqual(await response.json(),{accepted:true,epoch:7,duplicate:false});
  assert.deepEqual(calls,[['status',{}]]);
  assert.equal(reports.length,0,'HTTP 202 must not imply completed preflight');
  status.resolve({epoch:11,execution_enabled:false,owner_binding_sha256:OWNER_A});
  assert.deepEqual(await bounded(reported.promise,'successful preflight report'),{
   event:'sprite.preflight',requested_epoch:7,control_epoch:11,control_reachable:true,
   owner_binding_verified:true,execution_enabled:false,executor_ready:false,
   reason:'NATIVE_COMPATIBILITY_GATE_BLOCKED'
  });
 });
 assert.deepEqual(calls,[['status',{}]],'preflight must not claim, boot, or invoke model actions');
 assertSanitized(reports);
});

test('missing or different control owner bindings fail through the generic async wake path',async()=>{
 for(const controlStatus of [
  {epoch:12,execution_enabled:false},
  {epoch:12,execution_enabled:false,owner_binding_sha256:OWNER_B}
 ]){
  const reported=deferred(),reports=[],calls=[];
  await withService({control:{request:async(name,payload)=>{calls.push([name,payload]);return controlStatus;}},report:value=>{reports.push(value);reported.resolve(value);}},async origin=>{
   assert.equal((await bounded(wake(origin),'HTTP wake response')).status,202);
   assert.deepEqual(await bounded(reported.promise,'failed preflight report'),{event:'sprite.preflight_failed',code:'WAKE_RECONCILIATION_REQUIRED'});
  });
  assert.deepEqual(calls,[['status',{}]]);
  assertSanitized(reports);
 }
});

test('expected owner binding is validated before any credential is loaded',()=>{
 for(const ownerBindingSha256 of [undefined,'a'.repeat(63),'A'.repeat(64),'g'.repeat(64),null]){
  let credentialLoads=0;
  assert.throws(()=>createPreflightService({port:8080,ownerBindingSha256},{privateFile:()=>{credentialLoads++;return WAKE_TOKEN;},control:{request:async()=>{throw new Error('must not run');}}}),/Invalid service configuration/);
  assert.equal(credentialLoads,0);
 }
});

test('structured configuration capture prevents caller mutation during awaited status',async()=>{
 const config={port:8080,ownerBindingSha256:OWNER_A};
 const status=deferred(),requested=deferred(),reported=deferred(),reports=[],calls=[];
 const server=createPreflightService(config,{privateFile:()=>WAKE_TOKEN,control:{request:(name,payload)=>{calls.push([name,payload]);requested.resolve();return status.promise;}},report:value=>{reports.push(value);reported.resolve(value);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const response=await bounded(wake(`http://127.0.0.1:${server.address().port}`),'HTTP wake response');
  assert.equal(response.status,202);await bounded(requested.promise,'status request');
  config.ownerBindingSha256=OWNER_B;
  status.resolve({epoch:13,execution_enabled:true,owner_binding_sha256:OWNER_A});
  const report=await bounded(reported.promise,'captured-binding report');
  assert.equal(report.owner_binding_verified,true);assert.equal(report.executor_ready,false);
  assert.deepEqual(calls,[['status',{}]]);
  assertSanitized(reports);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('unauthorized real HTTP wake performs no control action and emits no report',async()=>{
 const calls=[],reports=[];
 await withService({control:{request:async(...args)=>{calls.push(args);}},report:value=>reports.push(value)},async origin=>{
  const response=await bounded(wake(origin,'unauthorized-secret-marker-123456789'),'unauthorized response');
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'UNAUTHORIZED'});
 });
 assert.deepEqual(calls,[]);assert.deepEqual(reports,[]);assertSanitized(reports);
});
