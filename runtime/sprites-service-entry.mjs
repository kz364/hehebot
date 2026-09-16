import http from 'node:http';
import {readFileSync,lstatSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ControlClient} from './control-client.mjs';
import {createSpritesWakeHandler} from './sprites-wake-service.mjs';

function privateFile(path){
 if(typeof path!=='string'||!isAbsolute(path))throw new Error('Private file path required');
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>32768||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw new Error('Private file permissions required');
 return readFileSync(path,'utf8').trim();
}
/** Runnable transport preflight only. It cannot claim jobs or invoke a model.
 * Keep this limitation explicit until native activity/settlement gates pass. */
export function createPreflightService(config,dependencies={}){
 config=structuredClone(config);
 const allowed=['portalOrigin','runtimeTokenFile','wakeTokenFile','accessClientIdFile','accessClientSecretFile','port','ownerBindingSha256'];
 if(!config||Object.keys(config).some(key=>!allowed.includes(key))||!Number.isInteger(config.port??8080)||(config.port??8080)<1024||(config.port??8080)>65535||typeof config.ownerBindingSha256!=='string'||!/^[a-f0-9]{64}$/.test(config.ownerBindingSha256))throw new Error('Invalid service configuration');
 const load=dependencies.privateFile??privateFile;
 const control=dependencies.control??new ControlClient({origin:config.portalOrigin,token:load(config.runtimeTokenFile),
  ...(config.accessClientIdFile||config.accessClientSecretFile?{accessClientId:load(config.accessClientIdFile),accessClientSecret:load(config.accessClientSecretFile)}:{})});
 const report=dependencies.report??(value=>console.info(JSON.stringify(value)));
 const handler=createSpritesWakeHandler({token:load(config.wakeTokenFile),onWake:async({epoch})=>{
  const status=await control.request('status',{});
  if(!status||!Number.isSafeInteger(status.epoch)||typeof status.execution_enabled!=='boolean')throw new Error('Invalid control status');
  if(status.owner_binding_sha256!==config.ownerBindingSha256)throw new Error('Control owner binding mismatch');
  report({event:'sprite.preflight',requested_epoch:epoch,control_epoch:status.epoch,control_reachable:true,owner_binding_verified:true,execution_enabled:status.execution_enabled,executor_ready:false,reason:'NATIVE_COMPATIBILITY_GATE_BLOCKED'});
 },onFailure:code=>report({event:'sprite.preflight_failed',code})});
 return http.createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},(req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"INTERNAL_ERROR"}');});});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const config=JSON.parse(privateFile(process.env.SPRITE_SUPERVISOR_CONFIG));
  const server=createPreflightService(config);server.listen(config.port??8080,'0.0.0.0',()=>console.info(JSON.stringify({event:'sprite.service_ready',mode:'transport-preflight-only'})));
  const stop=()=>server.close(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);
 }catch{console.error('Sprite supervisor configuration is invalid; no secrets printed.');process.exitCode=1;}
}
