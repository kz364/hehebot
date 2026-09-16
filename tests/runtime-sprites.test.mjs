import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import http from 'node:http';
import {SpritesActivityGuard} from '../runtime/sprites-activity-guard.mjs';
import {createSpritesTaskTransport} from '../runtime/sprites-task-transport.mjs';
function fixture(){let now=0,holds=0,releases=0,unsafe=0;const tasks={hold:async x=>(holds++,{name:x.id,expiresAt:x.expiresAt}),release:async()=>{releases++;}};const guard=new SpritesActivityGuard({tasks,id:'epoch-1',now:()=>now,onUnsafe:()=>unsafe++});return {guard,tasks,time:x=>now=x,counts:()=>({holds,releases,unsafe})};}
test('activity admission renews before expiry without duplicate parallel holds',async()=>{const f=fixture();await Promise.all([f.guard.ensure(),f.guard.ensure()]);assert.equal(f.counts().holds,1);f.time(70000);await f.guard.ensure();assert.equal(f.counts().holds,2);});
test('expired warm-resume hold refuses reclaim and notifies supervisor',async()=>{const f=fixture();await f.guard.ensure();f.time(130000);await assert.rejects(f.guard.ensure());assert.deepEqual(f.counts(),{holds:1,releases:0,unsafe:1});});
test('renewal readback cannot silently bridge expiry of the previous activity hold', async () => {
 for (const completedAt of [119999,120000,120001]) {
  const f=fixture();await f.guard.ensure();f.time(90000);
  const hold=f.tasks.hold;let complete;
  f.tasks.hold=input=>{const receipt=hold(input);return new Promise(resolve=>{complete=()=>receipt.then(resolve);});};
  const renewing=f.guard.ensure();
  const checked=completedAt<120000?renewing:assert.rejects(renewing,/Activity admission blocked/);
  await new Promise(setImmediate);assert.equal(typeof complete,'function');
  f.time(completedAt);complete();await checked;
  assert.equal(f.counts().holds,2);assert.equal(f.counts().releases,0);
  if(completedAt<120000){assert.equal(f.guard.receipt.expiresAt,210000);assert.equal(f.counts().unsafe,0);}
  else{
   assert.equal(f.counts().unsafe,1);
   await assert.rejects(f.guard.ensure(),/reconciliation/);
   await assert.rejects(f.guard.releaseAfterDrain({nativeSettled:true,checkpointDurable:true,controlCommitted:true}),/activity retained/);
   assert.deepEqual(f.counts(),{holds:2,releases:0,unsafe:1});
  }
 }
});
test('unproven drain retains Task, confirmed drain releases',async()=>{const f=fixture();await f.guard.ensure();await assert.rejects(f.guard.releaseAfterDrain({nativeSettled:true}));assert.equal(f.counts().releases,0);await f.guard.releaseAfterDrain({nativeSettled:true,checkpointDurable:true,controlCommitted:true});assert.equal(f.counts().releases,1);});
test('failed hold blocks admission and never removes prior Task',async()=>{const f=fixture();f.tasks.hold=async()=>{throw Error('private payload');};await assert.rejects(f.guard.ensure(),e=>!e.message.includes('private payload'));await assert.rejects(f.guard.ensure());assert.equal(f.counts().releases,0);});
test('unix transport uses fixed socket and no external auth header',async()=>{let options;const request=(o,cb)=>{options=o;const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=200;cb(res);res.emit('data',Buffer.from('{"name":"test"}'));res.emit('end');};return req;};const transport=createSpritesTaskTransport({request});const r=await transport({socketPath:'/.sprite/api.sock',host:'sprite',method:'GET',path:'/v1/tasks/test'});assert.equal(r.body.name,'test');assert.equal(options.headers.Authorization,undefined);await assert.rejects(transport({socketPath:'/tmp/bad',host:'sprite',method:'GET',path:'/v1/tasks/test'}));});
test('native plain-text absence and mutation responses preserve status without exposing bodies', async () => {
 const input={socketPath:'/.sprite/api.sock',host:'sprite',method:'GET',path:'/v1/tasks/test'};
 let status=404;
 const request=(_options,callback)=>{
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
  req.end=()=>{const res=new EventEmitter();res.statusCode=status;callback(res);res.emit('data',Buffer.from('private provider text: task not found'));res.emit('end');};return req;
 };
 const transport=createSpritesTaskTransport({request});
 assert.deepEqual(await transport(input),{status:404,body:undefined});
 status=500;assert.deepEqual(await transport(input),{status:500,body:undefined});
 status=200;await assert.rejects(transport(input),/outcome unknown/);
 assert.deepEqual(await transport({...input,method:'PUT',body:{expire:30}}),{status:200,body:undefined});
 status=204;assert.deepEqual(await transport({...input,method:'DELETE'}),{status:204,body:undefined});
});
test('native Tasks absolute deadline bounds pre-response stalls and trickling bodies', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 for(const mode of ['no-response','trickle'])for(const method of ['GET','PUT','DELETE']){
  let req,res,destroyed=0,state='pending';
  const request=(_options,callback)=>{
   req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{destroyed++;};
   req.end=()=>{if(mode==='trickle'){res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};callback(res);}};return req;
  };
  const transport=createSpritesTaskTransport({request,timeoutMs:50});
  const observed=transport({socketPath:'/.sprite/api.sock',host:'sprite',method,path:'/v1/tasks/test',body:{expire:30}})
   .then(()=>{state='resolved';},error=>{state=error.message;});
  try{
   t.mock.timers.tick(25);res?.emit('data',Buffer.from(' '));
   t.mock.timers.tick(24);res?.emit('data',Buffer.from(' '));await Promise.resolve();
   assert.equal(state,'pending');assert.equal(destroyed,0);
   t.mock.timers.tick(1);await Promise.resolve();
   assert.equal(state,'Native Tasks request failed; outcome unknown',`${mode} ${method}`);
   assert.equal(destroyed,1);
   res?.emit('data',Buffer.from('{"name":"late"}'));res?.emit('end');await Promise.resolve();
   assert.equal(state,'Native Tasks request failed; outcome unknown');
  }finally{req.emit('error',new Error('synthetic cleanup'));await observed;}
 }
});
test('completed or failed native Tasks requests clear their absolute timer', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 for(const mode of ['success','error','aborted','invalid-json']){
  let destroyed=0;
  const request=(_options,callback)=>{
   const req=new EventEmitter();req.destroy=()=>{destroyed++;};req.setTimeout=()=>{};
   req.end=()=>{
    if(mode==='error'){req.emit('error',new Error('private transport details'));return;}
    const res=new EventEmitter();res.statusCode=200;callback(res);
    if(mode==='aborted'){res.emit('aborted');return;}
    res.emit('data',Buffer.from(mode==='success'?'{"name":"test"}':'private invalid JSON'));res.emit('end');
   };return req;
  };
  const result=createSpritesTaskTransport({request,timeoutMs:50})({socketPath:'/.sprite/api.sock',host:'sprite',method:'GET',path:'/v1/tasks/test'});
  if(mode==='success')assert.deepEqual(await result,{status:200,body:{name:'test'}});
  else await assert.rejects(result,{message:'Native Tasks request failed; outcome unknown'});
  t.mock.timers.tick(100);assert.equal(destroyed,0,mode);
 }
});
test('real HTTP trickle cannot extend the native Tasks elapsed deadline', async () => {
 let chunks=0;
 const server=http.createServer((_req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});res.write(' ');chunks++;
  const timer=setInterval(()=>{res.write(' ');chunks++;},10);
  const end=setTimeout(()=>res.end('{"name":"test"}'),1000);
  res.on('close',()=>{clearInterval(timer);clearTimeout(end);});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  // Redirect only this injected test transport; production retains its fixed socket.
  const request=({socketPath,host,...options},callback)=>http.request({...options,host:'127.0.0.1',port:server.address().port},callback);
  await assert.rejects(createSpritesTaskTransport({request,timeoutMs:100})({socketPath:'/.sprite/api.sock',host:'sprite',method:'GET',path:'/v1/tasks/test'}),{message:'Native Tasks request failed; outcome unknown'});
  assert.ok(chunks>1,'response streamed rather than remaining idle');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
