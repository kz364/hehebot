import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createSpritesWakeHandler} from '../runtime/sprites-wake-service.mjs';
const token='synthetic-only-'.repeat(4);
async function call(handler,body,headers={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url:'/wake',headers:{'content-type':'application/json','x-hehe-wake-token':token,...headers}});const res=Object.assign(new EventEmitter(),{status:0,body:null,writeHead(s){this.status=s;},end(s){this.body=JSON.parse(s);this.writableFinished=true;this.emit('finish');}});await handler(req,res);await new Promise(resolve=>setImmediate(resolve));return res;}
test('same wake id/epoch queues once and stale wakes never disturb current work',async()=>{const calls=[];const handler=createSpritesWakeHandler({token,onWake:x=>calls.push(x)});const body={epoch:1,operationId:randomUUID()};assert.equal((await call(handler,body)).status,202);assert.equal((await call(handler,body)).body.duplicate,true);assert.equal(calls.length,1);assert.equal((await call(handler,{epoch:1,operationId:randomUUID()})).status,409);await call(handler,{epoch:2,operationId:randomUUID()});assert.equal((await call(handler,body)).status,409);assert.equal(calls.length,2);});
test('wake rejects auth, unknown fields and oversized bodies without calling executor',async()=>{let n=0;const handler=createSpritesWakeHandler({token,onWake:()=>n++});const body={epoch:1,operationId:randomUUID()};assert.equal((await call(handler,body,{'x-hehe-wake-token':'wrong'})).status,401);assert.equal((await call(handler,{...body,text:'prompt injection'})).status,422);assert.equal((await call(handler,{...body,text:'x'.repeat(1200)})).status,413);assert.equal(n,0);});
test('async bootstrap failures report only a stable code',async()=>{const errors=[];const handler=createSpritesWakeHandler({token,onWake:async()=>{throw Error('private');},onFailure:e=>errors.push(e)});await call(handler,{epoch:1,operationId:randomUUID()});assert.deepEqual(errors,['WAKE_RECONCILIATION_REQUIRED']);});

test('preparation timeout aborts authority and rejects late completion and duplicates without launch',async()=>{
 let finish,signal,preparations=0,launches=0;const failures=[];
 const handler=createSpritesWakeHandler({token,prepareTimeoutMs:25,
  prepareWake:(_request,context)=>{preparations++;signal=context.signal;return new Promise(ok=>{finish=ok;});},
  onWake:()=>{launches++;},onFailure:code=>failures.push(code)});
 const body={epoch:2,operationId:randomUUID()};
 assert.equal((await call(handler,body)).status,503);assert.equal(signal.aborted,true);
 finish(()=>{});await new Promise(ok=>setImmediate(ok));
 assert.equal((await call(handler,body)).status,503);
 assert.equal(preparations,1);assert.equal(launches,0);assert.deepEqual(failures,['WAKE_PREPARATION_FAILED']);
});

test('late preparation cannot beat an overdue timer in the microtask queue',async()=>{
 let launches=0;
 const handler=createSpritesWakeHandler({token,prepareTimeoutMs:10,prepareWake:async()=>{
  const end=Date.now()+25;while(Date.now()<end){} // Simulate a stalled process, not successful timely preparation.
  return ()=>{};
 },onWake:()=>{launches++;}});
 assert.equal((await call(handler,{epoch:2,operationId:randomUUID()})).status,503);
 assert.equal(launches,0);
});
