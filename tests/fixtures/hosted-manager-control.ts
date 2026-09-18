import { randomUUID } from 'node:crypto';
import { PersonalControl } from '../../src/worker/control-object';
import type { ControlCore } from '../../src/core/control';
import type { LifecycleCore } from '../../src/core/lifecycle';
export { default } from '../../src/worker/index';

/** Fixture-only predecessor seed. Never routed by the public Worker: the test
 * calls this directly through Miniflare's namespace, before the fresh message. */
export class HostedManagerControl extends PersonalControl {
  protected async sendHostedWake(): Promise<void> {
    // The caller drives the manager handoff explicitly. Never contact a Sprite.
  }
  async fetch(request: Request) {
    if (!['http://127.0.0.1/fixture-retire', 'http://127.0.0.1/fixture-manifest'].includes(request.url) || request.method !== 'POST')
      return new Response('Not found', { status: 404 });
    await request.text();
    const { core, lifecycle } = this as unknown as { core: ControlCore; lifecycle: LifecycleCore };
    if (request.url.endsWith('/fixture-manifest')) return Response.json(core.bootstrap.assignedManifest() ?? null);
    const policy = core.ownerAlpha.configuredPolicy!;
    if (lifecycle.get().epoch !== 0 || Date.parse(policy.expires_at) >= Date.now())
      throw new Error('Fixture requires one expired, unused predecessor');
    const originalNow = core.options.now;
    try {
      core.options.now = () => new Date(Date.parse(policy.expires_at) - 1000);
      const identity = lifecycle.registerBoot(randomUUID());
      lifecycle.ready(identity);
      core.options.now = originalNow;
      lifecycle.watchdog();
      core.bootstrap.recordRetirement({ ...identity, session_id: policy.session_id, transition_id: null,
        observed_at: core.now(), direct_child_stopped: true, execution_lock_free: true,
        session_lock_free: true, source: 'synthetic-unused-predecessor-no-native-started' });
      return Response.json({ epoch: identity.epoch });
    } finally { core.options.now = originalNow; }
  }
}
