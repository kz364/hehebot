import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { EffectLedger } from '../src/core/effects';
import { BROWSER_POLICY } from '../src/core/agent-commands';
import { bot, fixture, otherBot } from './helpers';

// Browser page actions are recorded as mutations authorized by the `browser`
// tool policy (BROWSER_POLICY) granted to the run's persona snapshot (runtime/browser-gateway.mjs).
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, effects: EffectLedger;
beforeEach(() => {
  f = fixture(true); f.core.options.toolPolicyIds.push(BROWSER_POLICY);
  const persona = f.store.get<{ name: string; instructions: string; tool_policy_ids: string[]; archived: boolean }>(bot, 'persona');
  expect(f.accept({ schema_version: 1, type: 'persona.put', payload: { ...persona.body, id: bot, expected_revision: persona.revision, tool_policy_ids: [BROWSER_POLICY] } }).status).toBe('applied');
  life = new LifecycleCore(f.store, f.core); effects = new EffectLedger(f.store, () => f.core.now());
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function running(persona: string) {
  const run = f.core.enqueue(persona, 'Look something up', null, null, null);
  expect(life.claim(identity)?.run.id).toBe(run); life.submitted(identity, run, 1, `native:${run}`);
  return run;
}
const click = (run_id: string) => ({ id: randomUUID(), run_id, attempt: 1, action_key: `browser:${run_id}:1:x:1`, classification: 'mutation' as const,
  authorization_ref: BROWSER_POLICY, request_digest: 'sha256:click', provider_idempotency_key: null });

it('a persona granted the browser policy may record page actions', () => {
  const run = running(bot);
  expect(effects.intent(click(run)).status).toBe('intent');
});
it('a persona without the grant cannot', () => {
  const run = running(otherBot);
  expect(() => effects.intent(click(run))).toThrow(/not authorized/);
});
it('the portal is offered only the tool switches this deployment authorizes', () => {
  expect(f.core.state().settings.grantable_tools).toEqual([expect.objectContaining({ id: BROWSER_POLICY, label: 'Browser use' })]);
  f.core.options.toolPolicyIds.length = 0;
  expect(f.core.state().settings.grantable_tools).toEqual([]);
});
