import {describe,expect,it} from 'vitest';
import {parseExecutionMode} from '../src/core/execution-mode';

// G8: the grok execution mode is an explicit, default-off switch that cannot
// coexist with owner-alpha/test-campaign custody.
const token='t'.repeat(40);
const sprites=JSON.stringify({provider:'fly-sprites',ref:{provider:'fly-sprites',id:'hehebot-grok'}});
const fake=JSON.stringify({provider:'fake',ref:{provider:'fake',id:'rehearsal'}});
const hosted={HEHEBOT_EXECUTION_MODE:'grok',AUTH_MODE:'access',OWNER_SUB:'owner-sub',EXECUTION_ENABLED:'true',PROVIDER_CONFIG:sprites,RUNTIME_TOKEN:token};

describe('parseExecutionMode',()=>{
 it('is off unless explicitly set',()=>{
  expect(parseExecutionMode({})).toBeUndefined();
  expect(parseExecutionMode({...hosted,HEHEBOT_EXECUTION_MODE:''})).toBeUndefined();
 });
 it('accepts the hosted Sprites configuration and the loopback fake rehearsal',()=>{
  expect(parseExecutionMode(hosted)).toBe('grok');
  expect(parseExecutionMode({...hosted,AUTH_MODE:'local',PROVIDER_CONFIG:fake})).toBe('grok');
 });
 it.each([
  ['unknown mode',{HEHEBOT_EXECUTION_MODE:'fast'}],
  ['execution disabled',{EXECUTION_ENABLED:'false'}],
  ['no provider',{PROVIDER_CONFIG:'{}'}],
  ['fake provider behind Access',{PROVIDER_CONFIG:fake}],
  ['no runtime token',{RUNTIME_TOKEN:undefined}],
  ['no owner',{OWNER_SUB:''}],
  ['owner alpha',{HEHEBOT_OWNER_ALPHA:'{}'}],
  ['hosted owner alpha',{HEHEBOT_HOSTED_OWNER_ALPHA:'{}'}],
  ['warm generation',{HEHEBOT_OWNER_ALPHA_WARM_GENERATION:'{}'}],
  ['background generation',{HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION:'{}'}],
  ['test campaign',{HEHEBOT_TEST_CAMPAIGN:'{}'}],
 ])('fails closed: %s',(_,patch)=>{
  expect(()=>parseExecutionMode({...hosted,...patch})).toThrowError(expect.objectContaining({code:'INVALID_CONFIGURATION'}));
 });
});
