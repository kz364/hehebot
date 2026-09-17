import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {parseHostedOwnerAlpha,parseOwnerAlpha,type OwnerAlphaPolicy} from '../src/core/owner-alpha';

const policy:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:randomUUID(),expires_at:'2026-09-10T00:01:00.000Z',max_runs:2,max_task_seconds:45};
const digest='a'.repeat(64);
const base={AUTH_MODE:'access',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}'};
const encoded=(p:unknown=policy,owner_binding_sha256=digest)=>JSON.stringify({owner_binding_sha256,policy:p});

it('parses an exact hosted envelope and preserves optional background true',()=>{
 const background={...policy,background_first_root:true as const};
 expect(parseHostedOwnerAlpha(encoded(background),base)).toEqual({policy:background,ownerBindingSha256:digest});
});

it('keeps missing and empty hosted configuration off by default',()=>{
 expect(parseHostedOwnerAlpha(undefined,{})).toBeUndefined();
 expect(parseHostedOwnerAlpha('',{})).toBeUndefined();
 expect(parseOwnerAlpha(undefined,{})).toBeUndefined();
});

it.each([
 ['invalid JSON','{'],['non-object','null'],['missing key',JSON.stringify({policy})],['extra key',JSON.stringify({owner_binding_sha256:digest,policy,extra:true})],
 ['uppercase digest',encoded(policy,'A'.repeat(64))],['short digest',encoded(policy,'a'.repeat(63))],['non-string digest',encoded(policy,1 as unknown as string)],
 ['malformed policy',encoded({...policy,max_runs:4})],['policy extra key',encoded({...policy,extra:true})],['invalid background',encoded({...policy,background_first_root:false})],
])('rejects malformed hosted %s',(_description,value)=>expect(()=>parseHostedOwnerAlpha(value,base)).toThrow());

it.each([
 {AUTH_MODE:'local'},{EXECUTION_ENABLED:'true'},{NATIVE_VERIFIED:'true'},{PROVIDER_CONFIG:'{"ref":{}}'},{PROVIDER_CONFIG:'null'},{PROVIDER_CONFIG:'{'},
])('rejects hosted environment mismatch %j',change=>expect(()=>parseHostedOwnerAlpha(encoded(),{...base,...change})).toThrow());

it('rejects simultaneous local owner-alpha configuration',()=>{
 expect(()=>parseHostedOwnerAlpha(encoded(),{...base,HEHEBOT_OWNER_ALPHA:JSON.stringify(policy)})).toThrow();
 expect(parseHostedOwnerAlpha(encoded(),{...base,HEHEBOT_OWNER_ALPHA:''})).toEqual({policy,ownerBindingSha256:digest});
});

it('accepts an exact text-only pin and rejects background coexistence or malformed hashes',()=>{
 const text_only={profile_version:'codex-text-only-v1' as const,profile_sha256:'a'.repeat(64)};
 expect(parseHostedOwnerAlpha(encoded({...policy,text_only}),base)?.policy.text_only).toEqual(text_only);
 for(const changed of [{...policy,text_only,background_first_root:true},{...policy,text_only:{...text_only,profile_sha256:'A'.repeat(64)}},{...policy,text_only:{...text_only,profile_version:'other'}}])
  expect(()=>parseHostedOwnerAlpha(encoded(changed),base)).toThrow();
});

it('preserves local parser serialization and rejection of Access auth',()=>{
 const local={AUTH_MODE:'local',EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}'};
 expect(JSON.stringify(parseOwnerAlpha(JSON.stringify(policy),local))).toBe(JSON.stringify(policy));
 expect(()=>parseOwnerAlpha(JSON.stringify(policy),base)).toThrow();
});
