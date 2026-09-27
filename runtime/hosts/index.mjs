/** Runtime host adapters. The v2 runtime is host-neutral; everything that
 * depends on where it runs lives behind this interface:
 *
 *   createService(config, dependencies) -> codex-service instance
 *   holdWake?(epoch, { holdMs })        -> keep the host awake until boot takes
 *                                          over (hosts that pause between
 *                                          requests, e.g. Sprites)
 *
 * Select with the runtime config's `host` (default "sprites"). To add a
 * provider, add a module here that exports createHost() and register it. The
 * Worker side has the matching registry in src/providers/factory.ts. */
const HOSTS = Object.freeze({
  sprites: () => import('./sprites.mjs'),
  local: () => import('./local.mjs'),
});

export const HOST_NAMES = Object.freeze(Object.keys(HOSTS));

export async function loadHost(name = 'sprites') {
  if (!Object.hasOwn(HOSTS, name)) throw Object.assign(new Error('UNKNOWN_RUNTIME_HOST'), { code: 'UNKNOWN_RUNTIME_HOST' });
  const host = (await HOSTS[name]()).createHost();
  if (typeof host?.createService !== 'function' || host.holdWake !== undefined && typeof host.holdWake !== 'function')
    throw Object.assign(new Error('INVALID_RUNTIME_HOST'), { code: 'INVALID_RUNTIME_HOST' });
  return host;
}
