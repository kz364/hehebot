import { createHash } from 'node:crypto';
import { readFile, mkdir, open, rename, chmod, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CronExpressionParser } from 'cron-parser';
const hash = value => createHash('sha256').update(value).digest('hex');
export function stableImportId(kind, slug) {
  const seeded={'chief-of-staff':'11111111-1111-4111-8111-111111111111','inbox-triage':'22222222-2222-4222-8222-222222222222',travel:'33333333-3333-4333-8333-333333333333'};
  if(kind==='persona'&&seeded[slug])return seeded[slug];
  const bytes = createHash('sha256').update(`claw-personal/bot-import/v1/${kind}/${slug}`).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 0x80; bytes[8] = (bytes[8] & 63) | 0x80;
  const h=bytes.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const error = () => new Error('Import source structure or catalog is invalid; source content withheld');
function section(text, heading) {
  const marker=`## ${heading}\n`;const start=text.indexOf(marker);if(start<0)throw error();
  const end=text.indexOf('\n## ',start+marker.length);return text.slice(start+marker.length,end<0?undefined:end).trim();
}
const PREFIX='Imported disabled setup proposal. Current owner authorization and system/tool policy govern execution. Historical approvals, accounts, permissions and profile assertions do not establish current authority. Connector mappings and scopes require owner adoption. No outbound email, WhatsApp or Messages send is authorized by this import.\n\n';
export function prepareBotImport(source, catalog, now) {
  if(typeof source!=='string'||Buffer.byteLength(source)>262144||!now||!Number.isFinite(Date.parse(now)))throw error();
  const preparedAt=new Date(now).toISOString();
  const marker='## Private source profile appendix — reference only, verify before use';
  const index=source.indexOf(marker);if(index<0||source.indexOf(marker,index+1)>=0)throw error();
  const publicPart=source.slice(0,index);const appendix=source.slice(index);
  const paragraphs=appendix.trim().split(/\n\s*\n/);if(paragraphs.length!==9)throw error();
  if(catalog.personas?.length!==5||catalog.routines?.length!==7)throw error();
  const personaSections=[...publicPart.matchAll(/^## \d+\. ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  if(personaSections.length!==5)throw error();
  const extracted=new Map();const personaBodies=new Map();
  for(const match of personaSections){
    const persona=catalog.personas.find(p=>p.name===match[1]);if(!persona||personaBodies.has(persona.slug))throw error();
    const body=match[2];const native=body.match(/^### Persona instructions\n([\s\S]*?)(?=^### |$(?![\s\S]))/m);if(!native)throw error();personaBodies.set(persona.slug,native[1].trim());
    for(const routine of body.matchAll(/^### Routine: `([^`]+)`\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)){
      if(extracted.has(routine[1]))throw error();extracted.set(routine[1],{owner:persona.slug,instructions:routine[2].trim()});
    }
  }
  if(extracted.size!==7)throw error();
  const sharedRaw=section(publicPart,'Shared user memory and calendar rules');
  const privateMappings=sharedRaw.split('\n').filter(line=>/^- (Owner display name|Owner Google account|Eve\/JIS calendar source ID|Imported “Lych)/.test(line));
  const shared=PREFIX+section(publicPart,'Native-first implementation')+'\n\n'+section(publicPart,'Import/setup contract')+'\n\n'+sharedRaw.split('\n').filter(line=>!privateMappings.includes(line)).join('\n')+'\n\n'+section(publicPart,'Scheduling and watermarks');
  const commands=catalog.personas.map(p=>({schema_version:1,type:'persona.put',payload:{id:stableImportId('persona',p.slug),expected_revision:0,name:p.name,instructions:shared+'\n\n'+personaBodies.get(p.slug),tool_policy_ids:[],archived:false}}));
  const preview=[];let daily=0;
  for(const routine of catalog.routines){
    const parsed=extracted.get(routine.slug);if(!parsed||parsed.owner!==routine.owner||!parsed.instructions.includes('`'+routine.cron+'`'))throw error();
    commands.push({schema_version:1,type:'routine.put',payload:{id:stableImportId('routine',routine.slug),expected_revision:0,persona_id:stableImportId('persona',routine.owner),name:routine.name,instructions:PREFIX+parsed.instructions,schedule:{cron:routine.cron,timezone:routine.timezone},trigger_source_id:null,enabled:false,policy:{misfire:'coalesce',overlap:'queue_one',max_replay:1,max_lateness_seconds:86400},action_policy_ids:[]}});
    const iterator=CronExpressionParser.parse(routine.cron,{currentDate:preparedAt,tz:routine.timezone});
    preview.push({routine_id:stableImportId('routine',routine.slug),slug:routine.slug,cron:routine.cron,timezone:routine.timezone,next_executions:Array.from({length:3},()=>iterator.next().toISOString())});
    daily+=routine.cron.includes('1,7,9,11,13,15,17,19,21,23')?10:1;
  }
  if(daily!==52||commands.some(c=>c.payload.instructions.length>16000))throw error();
  const sourceHash=hash(source);const commandHash=hash(JSON.stringify(commands));
  const bundle={schema_version:1,kind:'bot-import-draft',manifest:{prepared_at:preparedAt,source_sha256:sourceHash,catalog_sha256:hash(JSON.stringify(catalog)),commands_sha256:commandHash,counts:{personas:5,routines:7,commands:12,private_profiles:7},adoption_required:true,all_routines_disabled:true,daily_occurrences:52,monitoring_occurrences:50,timezone_conflict:{source_header:'Asia/Jakarta',proposed_monitoring:'Asia/Singapore',school_events:'Asia/Jakarta',resolved:false},removed_duplicate_kicks:2,one_shot_flight_alarms_required:true,private_profile_reference:'private-profile-reference.json',capability_mapping_required:true},commands,preview,capability_requirements:{personas:catalog.personas.map(p=>({id:stableImportId('persona',p.slug),logical_ids:p.capabilities})),routines:catalog.routines.map(r=>({id:stableImportId('routine',r.slug),logical_ids:r.capabilities}))},shared_instructions:shared};
  const privateReference={schema_version:1,kind:'unverified-private-profile-reference',source_sha256:sourceHash,profile_count:7,verified:false,scope:'private-travel-review-only',exact_appendix:appendix,unverified_contact_calendar_mappings:privateMappings};
  return {bundle,privateReference};
}
async function privateWrite(path,data){
  const dir=dirname(path);await mkdir(dir,{recursive:true,mode:0o700});
  try{const existing=await lstat(path);if(existing.isSymbolicLink())throw error();}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=path+'.tmp-'+process.pid;const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}
  await rename(temporary,path);await chmod(path,0o600);
}
export async function prepareFiles({sourcePath='.local/imports/bot-routines-setup.md',catalogPath='config/bot-catalog.json',outputPath='.local/imports/prepared-bots.json',now}={}){
  const source=await readFile(sourcePath,'utf8');const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
  const {bundle,privateReference}=prepareBotImport(source,catalog,now);
  await privateWrite(resolve(dirname(outputPath),'private-profile-reference.json'),privateReference);await privateWrite(resolve(outputPath),bundle);
  return {counts:bundle.manifest.counts,source_sha256:bundle.manifest.source_sha256,commands_sha256:bundle.manifest.commands_sha256,daily_occurrences:52};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);const now=args.length===2&&args[0]==='--now'?args[1]:null;
  if(!now){console.error('Usage: node scripts/prepare-bot-import.mjs --now <ISO timestamp>');process.exitCode=1;}
  else try{console.log(JSON.stringify(await prepareFiles({now})));}catch{console.error('Import preparation failed; private source content withheld.');process.exitCode=1;}
}
