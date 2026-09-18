import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const received=[];let redirect=false;
const server=createServer((req,res)=>{
 let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
  received.push({path:req.url,method:req.method,authorization:req.headers.authorization,wakeToken:req.headers['x-hehe-wake-token'],body});
  res.writeHead(redirect?302:202,{'Content-Type':'application/json',...(redirect?{Location:'/must-not-receive-credentials'}:{})});
  res.end(JSON.stringify({accepted:true,epoch:6}));
 });
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const directory=await mkdtemp(join(tmpdir(),'wake-fetch-'));let child,timer;
try{
 // Synthetic credentials and a loopback receiver only. Exercise the default
 // workerd fetch, which rejects redirect:'error' before reaching any receiver.
 const code=await build({stdin:{contents:`import {sendHostedOwnerWake} from './src/worker/hosted-owner-wake.ts';export default {async fetch(){try{await sendHostedOwnerWake({transition_id:'33333333-3333-4333-8333-333333333333',url:'http://127.0.0.1:${server.address().port}'},{epoch:6,operationId:'33333333-3333-4333-8333-333333333333'},'p'.repeat(40),'w'.repeat(40));return Response.json({ok:true});}catch(error){return Response.json({ok:false,phase:error.phase,status:error.upstreamStatus});}}}`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
 await writeFile(join(directory,'worker.mjs'),code.outputFiles[0].text);
 await writeFile(join(directory,'wrangler.json'),JSON.stringify({name:'wake-fetch',main:'worker.mjs',compatibility_date:'2026-09-10',compatibility_flags:['nodejs_compat']}));
 child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','-c',join(directory,'wrangler.json'),'--local','--ip','127.0.0.1','--port','0'],{env:{PATH:process.env.PATH,HOME:directory,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 timer=setTimeout(()=>child.kill('SIGTERM'),45000);
 const base=await new Promise((resolve,reject)=>{let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs+=data;const match=logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);if(match)resolve(match[1]);});child.once('exit',()=>reject(Error('worker stopped: '+logs)));});
 const request=async()=>{const response=await fetch(base,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return response.json();};
 assert.deepEqual(await request(),{ok:true});
 redirect=true;
 assert.deepEqual(await request(),{ok:false,phase:'response',status:302});
 assert.deepEqual(received,Array(2).fill({path:'/wake',method:'POST',authorization:'Bearer '+'p'.repeat(40),wakeToken:'w'.repeat(40),body:JSON.stringify({epoch:6,operationId:'33333333-3333-4333-8333-333333333333'})}));
 console.log('PASS actual workerd default fetch: exact202 receipt accepted;302 rejected with no redirect request, credential forwarding or retry.');
}finally{clearTimeout(timer);if(child?.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}server.closeAllConnections();server.close();await rm(directory,{recursive:true,force:true});}
