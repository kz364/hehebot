import { ControlError, requireThat } from '../core/errors';
export async function readBounded(request:Request,maxBytes=128*1024):Promise<string>{
 const declared=request.headers.get('Content-Length');
 requireThat(!declared||Number(declared)<=maxBytes,'PAYLOAD_TOO_LARGE','Request exceeds the size limit.',413);
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>maxBytes){await reader.cancel();throw new ControlError('PAYLOAD_TOO_LARGE','Request exceeds the size limit.',413);}chunks.push(chunk.value);}}finally{reader.releaseLock();}
 const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(out);}catch{throw new ControlError('INVALID_INPUT','Request must be valid UTF-8.',422);}
}
export function parseJson(text:string):unknown {try{return JSON.parse(text);}catch{throw new ControlError('INVALID_INPUT','Request must contain JSON.',422);}}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value);
}
export async function digest(value:unknown,raw=false):Promise<string>{const bytes=new TextEncoder().encode(raw?String(value):canonical(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
export function json(value:unknown,status=200):Response{return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
