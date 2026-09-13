import http from 'node:http';

/** In-Sprite only. No API key: the fixed Unix socket identifies this VM. */
export function createSpritesTaskTransport({request = http.request, timeoutMs = 5000} = {}) {
 return input => new Promise((resolve,reject)=>{
  if(input.socketPath!=='/.sprite/api.sock'||input.host!=='sprite'||!['GET','PUT','DELETE'].includes(input.method)||!/^\/v1\/tasks\/[a-zA-Z0-9_-]+$/.test(input.path))return reject(new Error('Invalid native Tasks request'));
  if(input.method==='PUT'&&(!Number.isInteger(input.body?.expire)||input.body.expire<1||input.body.expire>3600))return reject(new Error('Invalid native Tasks expiry'));
  const data=input.method==='PUT'?JSON.stringify({expire:input.body.expire}):undefined;
  let settled=false;
  const fail=()=>{if(!settled){settled=true;reject(new Error('Native Tasks request failed; outcome unknown'));}};
  const req=request({socketPath:input.socketPath,host:input.host,method:input.method,path:input.path,headers:{Host:'sprite',...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>16384){fail();res.destroy();req.destroy();}else chunks.push(chunk);});
   res.on('error',fail);res.on('aborted',fail);
   res.on('end',()=>{if(settled)return;try{const raw=Buffer.concat(chunks).toString('utf8');const body=raw?JSON.parse(raw):undefined;settled=true;resolve({status:res.statusCode??0,body});}catch{fail();}});
  });
  req.setTimeout(timeoutMs,()=>{fail();req.destroy();});req.on('error',fail);req.end(data);
 });
}
