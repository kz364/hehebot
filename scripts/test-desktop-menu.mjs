#!/usr/bin/env node
// Linux GUI smoke only; macOS menu and browser acceptance remain separate.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';
const root=decodeURIComponent(new URL('../',import.meta.url).pathname);
const directory=await mkdtemp(join(tmpdir(),'hehe-desktop-menu-'));
const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Hehebot menu fixture</title><h1>Hehebot Portal</h1><p>Synthetic local page. Native menu inspection only; no authentication or external browser launch.</p>');});
let xvfb,electron;
try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 xvfb=spawn('Xvfb',['-displayfd','3','-screen','0','1280x900x24','-nolisten','tcp'],{stdio:['ignore','ignore','ignore','pipe']});
 const display=await new Promise((ok,reject)=>{const timer=setTimeout(()=>reject(Error('DISPLAY_UNAVAILABLE')),10000);xvfb.once('error',reject);xvfb.stdio[3].once('data',data=>{clearTimeout(timer);ok(':'+data.toString().trim());});});
 const env={...process.env,DISPLAY:display,XDG_CONFIG_HOME:join(directory,'config')};
 await mkdir(env.XDG_CONFIG_HOME,{mode:0o700});
 electron=spawn(join(root,'desktop/node_modules/electron/dist/electron'),[join(root,'desktop'),`--portal-origin=http://127.0.0.1:${server.address().port}`],{env,stdio:['ignore','ignore','pipe']});
 let diagnostic='';electron.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-8000);});
 const x=(...args)=>promisify(execFile)('xdotool',args,{env,timeout:5000});
 let window;
 for(let n=0;n<50&&!window;n++){
  assert.equal(electron.exitCode,null,'Electron exited before the native menu could be inspected');
  try{window=(await x('search','--onlyvisible','--name','Hehebot menu fixture')).stdout.trim().split('\n')[0];}catch{}
  if(!window)await new Promise(ok=>setTimeout(ok,200));
 }
 assert.ok(window,'Visible Electron window required');
 await x('windowfocus','--sync',window);await x('mousemove','--window',window,'55','12');await x('click','1');
 await new Promise(ok=>setTimeout(ok,300));
 const artifacts=join(root,'.amp/in/artifacts');await mkdir(artifacts,{recursive:true});
 await promisify(execFile)('import',['-window','root',join(artifacts,'desktop-portal-browser-menu.png')],{env,timeout:10000});
 assert.doesNotMatch(diagnostic,/No usable sandbox|SUID sandbox helper binary was found, but is not configured correctly/);
 console.log('PASS: sandbox-configured Linux Electron launched a private synthetic portal; native menu click and screenshot captured for inspection. No external browser launched.');
}finally{
 if(electron&&electron.exitCode===null){electron.kill('SIGTERM');await Promise.race([once(electron,'exit'),new Promise(ok=>setTimeout(ok,3000))]);}
 if(xvfb&&xvfb.exitCode===null){xvfb.kill('SIGTERM');await Promise.race([once(xvfb,'exit'),new Promise(ok=>setTimeout(ok,3000))]);}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));await rm(directory,{recursive:true,force:true});
}
