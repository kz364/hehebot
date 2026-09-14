import {timingSafeEqual} from 'node:crypto';

/** Compose with a supervisor on the Sprite HTTP Service port. The native runtime
 * stays loopback-only. This handler only queues a wake; it never submits a model.
 * Private Sprite URL auth is a separate edge layer from this application token. */
export function createSpritesWakeHandler({token,onWake,onFailure=()=>{}}){
 if(typeof token!=='string'||token.length<32||typeof onWake!=='function')throw new Error('Wake service configuration required');
 const expected=Buffer.from(token);let latestEpoch=0,latestOperation=null;
 return async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'||req.url!=='/wake'){reply(404,{error:'NOT_FOUND'});return;}
  const raw=req.headers['x-hehe-wake-token'];const candidate=Buffer.from(typeof raw==='string'?raw:'');
  if(candidate.length!==expected.length||!timingSafeEqual(candidate,expected)){reply(401,{error:'UNAUTHORIZED'});return;}
  if(req.headers['content-type']?.split(';')[0]!=='application/json'){reply(422,{error:'INVALID_INPUT'});return;}
  let body;
  try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024){reply(413,{error:'BODY_TOO_LARGE'});return;}chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{reply(422,{error:'INVALID_INPUT'});return;}
  if(!body||Object.keys(body).sort().join(',')!=='epoch,operationId'||!Number.isSafeInteger(body.epoch)||body.epoch<1||typeof body.operationId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.operationId)){reply(422,{error:'INVALID_INPUT'});return;}
  if(body.epoch<latestEpoch||body.epoch===latestEpoch&&body.operationId!==latestOperation){reply(409,{error:'STALE_EPOCH'});return;}
  if(body.epoch===latestEpoch){reply(202,{accepted:true,epoch:body.epoch,duplicate:true});return;}
  latestEpoch=body.epoch;latestOperation=body.operationId;
  // Respond before bootstrap: the control plane closes START_REQUESTED on the
  // wake response. Supervisor must then obtain its authenticated boot lease.
  reply(202,{accepted:true,epoch:body.epoch,duplicate:false});
  Promise.resolve().then(()=>onWake(Object.freeze({...body}))).catch(()=>onFailure('WAKE_RECONCILIATION_REQUIRED'));
 };
}
