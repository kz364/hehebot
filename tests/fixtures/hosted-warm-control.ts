import { PersonalControl } from '../../src/worker/control-object';
import type { ControlCore } from '../../src/core/control';
import type { LifecycleCore } from '../../src/core/lifecycle';
export { default } from '../../src/worker/index';

/** Fixture-only warm custody surface. The seeded epoch-1 predecessor boot id is
 * supplied by the caller because the same immutable identity must already be
 * frozen in the trusted seed retirement configuration. Never routed publicly.
 * The production PersonalControl alarm and sendHostedWake path runs unchanged:
 * its outbound wake fetch to the pinned synthetic Sprite destination is routed
 * by the fixture (startHostedControlFixture) to a disposable loopback listener. */
export class HostedWarmControl extends PersonalControl {
  async fetch(request: Request) {
    const routes = ['http://127.0.0.1/fixture-retire', 'http://127.0.0.1/fixture-wake', 'http://127.0.0.1/fixture-warm'];
    if (!routes.includes(request.url) || request.method !== 'POST') return new Response('Not found', { status: 404 });
    const { core, lifecycle } = this as unknown as { core: ControlCore; lifecycle: LifecycleCore };
    if (request.url.endsWith('/fixture-wake')) {
      await request.text();
      const rows = core.store.db.all<{ key: string; value_json: string }>(
        "SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*' ORDER BY key");
      return Response.json(rows.length ? JSON.parse(rows.at(-1)!.value_json) : null);
    }
    if (request.url.endsWith('/fixture-warm')) {
      await request.text();
      const rows = core.store.db.all<{ key: string; value_json: string }>(
        "SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' OR key GLOB 'owner_alpha_reservation:*' ORDER BY key");
      return Response.json(rows.map(row => ({ key: row.key, value: JSON.parse(row.value_json) })));
    }
    const body = JSON.parse(await request.text() || '{}') as { boot_id?: unknown };
    const policy = core.ownerAlpha.configuredPolicy!;
    if (typeof body.boot_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.boot_id) ||
        lifecycle.get().epoch !== 0 || Date.parse(policy.expires_at) >= Date.now())
      throw new Error('Fixture requires one expired, unused predecessor and its trusted epoch-1 boot id');
    const originalNow = core.options.now;
    try {
      // The warm contract writes its own seed retirement at first admission;
      // the fixture only proves the expired, unused predecessor boot here.
      core.options.now = () => new Date(Date.parse(policy.expires_at) - 1000);
      const identity = lifecycle.registerBoot(body.boot_id);
      lifecycle.ready(identity);
      core.options.now = originalNow;
      lifecycle.watchdog();
      return Response.json({ epoch: identity.epoch, boot_id: identity.boot_id });
    } finally { core.options.now = originalNow; }
  }
}
