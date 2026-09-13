import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBotImport, prepareFiles, stableImportId } from '../scripts/prepare-bot-import.mjs';
import validateCommand from '../src/generated/validate-command.js';
const catalog=JSON.parse(await readFile(new URL('../config/bot-catalog.json',import.meta.url),'utf8'));
function fixture(){
 let source='# Synthetic setup\n\n## Native-first implementation\n\nUse native tools.\n\n## Import/setup contract\n\nDisabled proposals only.\n\n## Shared user memory and calendar rules\n\nSchool uses Asia/Jakarta.\n\n## Scheduling and watermarks\n\nHeader Asia/Jakarta conflicts with proposed Asia/Singapore.\n\n';
 for(const [i,p] of catalog.personas.entries()){
  source+=`## ${i+1}. ${p.name}\n\n### Persona instructions\n\nKeep ${p.name} responsive.\n\n`;
  for(const r of catalog.routines.filter(r=>r.owner===p.slug))source+=`### Routine: \`${r.slug}\`\n\nCron \`${r.cron}\`, Asia/Singapore. Do bounded work.\n\n`;
 }
 return source+'## Private source profile appendix — reference only, verify before use\n\nUnverified historical records.\n\n'+Array.from({length:7},(_,i)=>`SYNTHETIC_PRIVATE_PROFILE_${i}`).join('\n\n')+'\n';
}
const now='2026-09-10T09:00:00Z';
test('prepares exact disabled canonical count without private profiles or grants',()=>{
 const {bundle,privateReference}=prepareBotImport(fixture(),catalog,now);
 assert.equal(bundle.commands.length,12);assert.equal(bundle.manifest.daily_occurrences,52);
 assert.equal(bundle.commands.filter(c=>c.type==='persona.put').length,5);
 for(const command of bundle.commands){assert.ok(validateCommand(command));assert.equal(command.payload.expected_revision,0);if(command.type==='routine.put'){assert.equal(command.payload.enabled,false);assert.deepEqual(command.payload.action_policy_ids,[]);}else assert.deepEqual(command.payload.tool_policy_ids,[]);}
 assert.ok(!JSON.stringify(bundle).includes('SYNTHETIC_PRIVATE_PROFILE'));
 assert.equal(privateReference.profile_count,7);assert.ok(privateReference.exact_appendix.includes('SYNTHETIC_PRIVATE_PROFILE_6'));
 assert.equal(bundle.manifest.timezone_conflict.resolved,false);
 for(const p of bundle.preview){assert.equal(p.next_executions.length,3);assert.ok(p.next_executions.every(x=>Date.parse(x)>Date.parse(now)));}
 assert.ok(bundle.commands.filter(c=>c.type==='persona.put').every(c=>c.payload.instructions.includes(bundle.shared_instructions)));
});
test('stable ids align seeded personas and repeat deterministically',()=>{
 const a=prepareBotImport(fixture(),catalog,now).bundle,b=prepareBotImport(fixture(),catalog,now).bundle;
 assert.deepEqual(a,b);assert.equal(stableImportId('persona','chief-of-staff'),'11111111-1111-4111-8111-111111111111');assert.equal(stableImportId('persona','inbox-triage'),'22222222-2222-4222-8222-222222222222');assert.equal(stableImportId('persona','travel'),'33333333-3333-4333-8333-333333333333');
 assert.equal(new Set(a.commands.map(c=>c.payload.id)).size,12);
});
test('rejects missing/duplicate sections, unexpected routines and implicit current time',()=>{
 assert.throws(()=>prepareBotImport(fixture(),catalog));
 assert.throws(()=>prepareBotImport(fixture().replace('### Persona instructions','### Missing'),catalog,now));
 assert.throws(()=>prepareBotImport(fixture().replace('francesca-email-calendar','not-canonical'),catalog,now));
 assert.throws(()=>prepareBotImport(fixture().replace('SYNTHETIC_PRIVATE_PROFILE_6',''),catalog,now));
});
test('writes only private 0600 artifacts and preserves source bytes on repeated preparation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bot-import-test-'));
 try{const sourcePath=join(dir,'source.md'),catalogPath=join(dir,'catalog.json'),outputPath=join(dir,'prepared-bots.json');await writeFile(sourcePath,fixture(),{mode:0o600});await writeFile(catalogPath,JSON.stringify(catalog));const before=await readFile(sourcePath);await prepareFiles({sourcePath,catalogPath,outputPath,now});const first=await readFile(outputPath);await prepareFiles({sourcePath,catalogPath,outputPath,now});assert.deepEqual(await readFile(outputPath),first);assert.deepEqual(await readFile(sourcePath),before);assert.equal((await stat(outputPath)).mode&0o777,0o600);assert.equal((await stat(join(dir,'private-profile-reference.json'))).mode&0o777,0o600);}finally{await rm(dir,{recursive:true,force:true});}
});
