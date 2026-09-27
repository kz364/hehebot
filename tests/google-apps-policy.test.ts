import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { EffectLedger } from '../src/core/effects';
import { BROWSER_POLICY, GOOGLE_POLICY } from '../src/core/agent-commands';
import { GOOGLE_POLICY as RUNTIME_GOOGLE_POLICY } from '../runtime/google-apps.mjs';
import { bot, fixture, otherBot } from './helpers';

// Gmail/Calendar writes are recorded as mutations authorized by GOOGLE_POLICY
// granted to the run's persona snapshot (runtime/google-apps.mjs fence).
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, effects: EffectLedger;
beforeEach(() => {
  f = fixture(true); f.core.options.toolPolicyIds.push(BROWSER_POLICY, GOOGLE_POLICY);
  const persona = f.store.get<{ name: string; instructions: string; tool_policy_ids: string[]; archived: boolean }>(bot, 'persona');
  expect(f.accept({ schema_version: 1, type: 'persona.put', payload: { ...persona.body, id: bot, expected_revision: persona.revision, tool_policy_ids: [GOOGLE_POLICY] } }).status).toBe('applied');
  life = new LifecycleCore(f.store, f.core); effects = new EffectLedger(f.store, () => f.core.now());
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function running(persona: string) {
  const run = f.core.enqueue(persona, 'Tidy my inbox', null, null, null);
  expect(life.claim(identity)?.run.id).toBe(run); life.submitted(identity, run, 1, `native:${run}`);
  return run;
}
const draft = (run_id: string, authorization_ref = GOOGLE_POLICY) => ({ id: randomUUID(), run_id, attempt: 1, action_key: `google:${run_id}:1:call-1`,
  classification: 'mutation' as const, authorization_ref, request_digest: 'a'.repeat(64), provider_idempotency_key: null });

it('runtime and Worker agree on the Gmail & Calendar policy id, and the hehebot deployment allows it', () => {
  expect(RUNTIME_GOOGLE_POLICY).toBe(GOOGLE_POLICY);
  const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  expect(JSON.parse(wrangler.env.hehebot.vars.TOOL_POLICY_IDS)).toContain(GOOGLE_POLICY);
});
it('a persona granted Gmail & Calendar may record a write; the browser grant does not stand in for it', () => {
  const run = running(bot);
  const effect = draft(run);
  expect(effects.intent(effect).status).toBe('intent');
  effects.transition(effect.id, run, 'dispatched', { kind: 'google_apps', tool: 'create_draft' });
  effects.transition(effect.id, run, 'confirmed', { kind: 'google_apps', tool: 'create_draft' });
  expect(() => effects.intent({ ...draft(run, BROWSER_POLICY), action_key: 'browser:x' })).toThrow(/not authorized/);
});
it('a persona without the grant cannot', () => {
  const run = running(otherBot);
  expect(() => effects.intent(draft(run))).toThrow(/not authorized/);
});
it('the portal offers the Gmail & Calendar switch only where the deployment allows it', () => {
  expect(f.core.state().settings.grantable_tools).toEqual([expect.objectContaining({ id: BROWSER_POLICY }),
    expect.objectContaining({ id: GOOGLE_POLICY, label: 'Gmail & Calendar',
      description: 'Read mail and calendars; labels, drafts and calendar changes are recorded as effects. Sending, forwarding and deleting mail is off.' })]);
  f.core.options.toolPolicyIds.splice(f.core.options.toolPolicyIds.indexOf(GOOGLE_POLICY), 1);
  expect(f.core.state().settings.grantable_tools.map((tool: { id: string }) => tool.id)).toEqual([BROWSER_POLICY]);
});
