import { describe, expect, it, vi } from 'vitest';
import { createProvider, createE2BHttpClient, RailwayProvider, E2BProvider, SpritesTasksClient, type SpritesTaskTransport, SpritesProvider, DaytonaProvider, FakeProvider, FlyMachinesProvider, type RuntimeRef } from '../src/providers';

const command = { operationId: 'op-1', epoch: 1 };
const flyRef: RuntimeRef = { provider: 'fly-machines', id: 'machine-1', scope: 'app-1', persistentStateId: 'vol-1' };
const daytonaRef: RuntimeRef = { provider: 'daytona', id: 'sandbox-1' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const machine = (state: string) => ({ id: 'machine-1', state, config: { mounts: [{ volume: 'vol-1' }] } });

describe('provider contract', () => {
  it('fake transition requests require later observation confirmation', async () => {
    const ref: RuntimeRef = { provider: 'fake', id: 'test' };
    const provider = new FakeProvider(() => 100);
    await provider.wake(ref, command);
    expect((await provider.observe(ref)).phase).toBe('starting');
    provider.setPhase(ref, 'running');
    await provider.stop(ref, command);
    expect((await provider.observe(ref)).executionStopped).toBe(false);
    provider.setPhase(ref, 'stopped');
    expect(await provider.observe(ref)).toMatchObject({ executionStopped: true, observedAt: 100 });
  });

});

describe('Fly Machines HTTP adapter', () => {
  it('uses documented endpoints and never sends domain epochs as invented provider fencing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
    const provider = new FlyMachinesProvider('secret', fetcher);
    await provider.wake(flyRef, command); await provider.stop(flyRef, command);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.machines.dev/v1/apps/app-1/machines/machine-1/start', 'https://api.machines.dev/v1/apps/app-1/machines/machine-1/stop']);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer secret' }, redirect: 'error' });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it.each(['started', 'starting', 'stopping', 'suspended', 'destroyed', 'new-state'])('does not confirm stopped for %s', async (state) => {
    const provider = new FlyMachinesProvider('secret', vi.fn<typeof fetch>().mockResolvedValue(json(machine(state))));
    expect((await provider.observe(flyRef)).executionStopped).toBe(false);
  });
  it('confirms stopped and configured persistent volume, without claiming Gateway readiness', async () => {
    const provider = new FlyMachinesProvider('secret', vi.fn<typeof fetch>().mockResolvedValue(json(machine('stopped'))));
    expect(await provider.observe(flyRef)).toMatchObject({ phase: 'stopped', executionStopped: true, persistentState: 'retained' });
  });
  it('does not treat missing mounted state as retained', async () => {
    const provider = new FlyMachinesProvider('secret', vi.fn<typeof fetch>().mockResolvedValue(json({ id: flyRef.id, state: 'stopped' })));
    expect((await provider.observe(flyRef)).persistentState).toBe('unknown');
  });
  it('404 cannot authorize replacement; response text is not exposed', async () => {
    const provider = new FlyMachinesProvider('secret', vi.fn<typeof fetch>().mockResolvedValue(json({ token: 'secret' }, 404)));
    await expect(provider.observe(flyRef)).rejects.toMatchObject({ code: 'http_error', status: 404 });
  });
  it('ambiguous mutation is never automatically retried', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret'));
    const provider = new FlyMachinesProvider('secret', fetcher);
    await expect(provider.stop(flyRef, command)).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed observations and wrong identities', async () => {
    const provider = new FlyMachinesProvider('secret', vi.fn<typeof fetch>().mockResolvedValue(json({ id: 'another', state: 'stopped' })));
    await expect(provider.observe(flyRef)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects missing credentials, cross-provider refs, and path injection before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new FlyMachinesProvider('', fetcher).observe(flyRef)).rejects.toMatchObject({ code: 'unconfigured' });
    const provider = new FlyMachinesProvider('secret', fetcher);
    await expect(provider.observe({ ...flyRef, id: '../test' })).rejects.toMatchObject({ code: 'invalid_ref' });
    await expect(provider.observe(daytonaRef)).rejects.toMatchObject({ code: 'invalid_ref' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Daytona HTTP adapter', () => {
  const safe = { id: 'sandbox-1', state: 'stopped', autoStopInterval: 0, autoPauseInterval: 0, autoDeleteInterval: -1 };
  it('checks lifecycle policy then requests start without assuming readiness', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(safe)).mockResolvedValueOnce(json({}));
    await new DaytonaProvider('secret', fetcher).wake(daytonaRef, command);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://app.daytona.io/api/sandbox/sandbox-1', 'https://app.daytona.io/api/sandbox/sandbox-1/start']);
  });
  it.each([{ autoStopInterval: 15 }, { autoPauseInterval: 5 }, { autoDeleteInterval: 0 }, { autoDestroyAt: '2026-09-11' }])('blocks dangerous lifecycle policy %j', async (policy) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...safe, ...policy }));
    await expect(new DaytonaProvider('secret', fetcher).wake(daytonaRef, command)).rejects.toMatchObject({ code: 'unconfigured' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['stopping', 'paused', 'archived', 'destroyed'])('does not infer termination from %s', async (state) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...safe, state }));
    expect((await new DaytonaProvider('secret', fetcher).observe(daytonaRef)).executionStopped).toBe(false);
  });
  it('requests stop and independently observes confirmation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(safe));
    const provider = new DaytonaProvider('secret', fetcher);
    await provider.stop(daytonaRef, command);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://app.daytona.io/api/sandbox/sandbox-1/stop');
    expect((await provider.observe(daytonaRef)).executionStopped).toBe(true);
  });
});

describe('E2B SDK adapter', () => {
  const ref: RuntimeRef = { provider: 'e2b', id: 'sandbox-1' };
  const client = () => ({ getInfo: vi.fn().mockResolvedValue({ sandboxId: ref.id, state: 'paused', lifecycle: {onTimeout: 'pause', autoResume: false} }), connect: vi.fn().mockResolvedValue({}), pause: vi.fn().mockResolvedValue(true) });
  it('requests filesystem-only pause, observes paused separately, and never claims termination', async () => {
    const sdk = client(); const provider = new E2BProvider(sdk, true);
    await provider.stop(ref, command);
    expect(sdk.pause).toHaveBeenCalledWith(ref.id, { keepMemory: false, requestTimeoutMs: 15000 });
    expect(await provider.observe(ref)).toMatchObject({ executionPaused: true, executionStopped: false, phase: 'unknown' });
    expect(provider.capabilities.stopMode).toBe('pause-filesystem');
  });
  it('resumes using explicit bounded session timeout only after lifecycle verification', async () => {
    const sdk = client();
    await expect(new E2BProvider(sdk).wake(ref, command)).rejects.toMatchObject({ code: 'unconfigured' });
    expect(sdk.connect).not.toHaveBeenCalled();
    await new E2BProvider(sdk, true).wake(ref, command);
    expect(sdk.connect).toHaveBeenCalledWith(ref.id, { timeoutMs: 1800000, requestTimeoutMs: 15000 });
  });
  it('does not turn SDK failure into paused state or retry', async () => {
    const sdk = client(); sdk.pause.mockRejectedValue(new Error('503 secret'));
    await expect(new E2BProvider(sdk, true).stop(ref, command)).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(sdk.pause).toHaveBeenCalledTimes(1);
  });
  it('factory requires injected SDK and does not silently fall back', async () => {
    await expect(createProvider({ provider: 'e2b' }).observe(ref)).rejects.toMatchObject({ code: 'unconfigured' });
  });
});

describe('Sprites partial HTTP adapter', () => {
  const ref: RuntimeRef = { provider: 'fly-sprites', id: 'my-sprite' };
  it.each(['running', 'warm', 'cold'])('observes %s without claiming replacement fencing', async (status) => {
    const provider = new SpritesProvider('secret', 'gateway', true, vi.fn<typeof fetch>().mockResolvedValue(json({ name: ref.id, status })));
    expect((await provider.observe(ref)).executionStopped).toBe(false);
  });
  it('refuses wake before native Tasks bridge verification', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new SpritesProvider('secret', 'gateway', false, fetcher).wake(ref, command)).rejects.toMatchObject({ code: 'unconfigured' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses service start NDJSON and rejects an error even with HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"type":"started"}\n{"type":"complete"}\n')).mockResolvedValueOnce(json({accepted:true,epoch:1},202)).mockResolvedValueOnce(new Response('{"type":"error","data":"secret"}\n'));
    const provider = new SpritesProvider('secret', 'gateway', true, fetcher,Date.now,undefined,{url:'https://my-sprite-org.sprites.app',token:'synthetic-wake-secret-'.repeat(3)});
    await provider.wake(ref, command);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.sprites.dev/v1/sprites/my-sprite/services/gateway/start');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({'X-Hehe-Wake-Token':'synthetic-wake-secret-'.repeat(3)});
    await expect(provider.wake(ref, command)).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('refuses to emulate VM stop with destructive deletion or one service stop', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new SpritesProvider('secret', 'gateway', true, fetcher).stop(ref, command)).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('E2B Worker HTTP bridge', () => {
  const ref: RuntimeRef = { provider: 'e2b', id: 'sandbox-1' };
  it('factory uses real fetch bridge with documented REST casing, auth, seconds and memory flag', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sandboxID: ref.id, state: 'paused', lifecycle: { onTimeout: 'pause', autoResume: false }, envdAccessToken: 'private' }))
      .mockResolvedValueOnce(json({ sandboxID: ref.id }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createProvider({ provider: 'e2b', token: 'key', lifecycleVerified: true }, fetcher);
    await provider.wake(ref, command); await provider.stop(ref, command);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.e2b.app/sandboxes/sandbox-1', 'https://api.e2b.app/sandboxes/sandbox-1/connect', 'https://api.e2b.app/sandboxes/sandbox-1/pause']);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-API-Key': 'key' });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ timeout: 1800 });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ memory: false });
  });
  it('rejects unsafe lifecycle readback before connect', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ sandboxID: ref.id, state: 'running', lifecycle: { onTimeout: 'kill', autoResume: false } }));
    await expect(createProvider({ provider: 'e2b', token: 'key', lifecycleVerified: true }, fetcher).wake(ref, command)).rejects.toMatchObject({ code: 'unconfigured' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not return credential fields from info bridge', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ sandboxID: ref.id, state: 'paused', envdAccessToken: 'private' }));
    expect(await createE2BHttpClient('key', fetcher).getInfo(ref.id, { requestTimeoutMs: 15000 })).not.toHaveProperty('envdAccessToken');
  });
});

describe('Railway deployment API adapter', () => {
  const ref: RuntimeRef = { provider: 'railway', id: 'deployment-1' };
  it.each(['SUCCESS', 'SLEEPING', 'REMOVED', 'CRASHED'])('observes %s without inventing stopped confirmation', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: { deployment: { id: ref.id, status } } }));
    expect((await new RailwayProvider('key', 'project', true, fetcher).observe(ref)).executionStopped).toBe(false);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Project-Access-Token': 'key' });
  });
  it('uses documented stop mutation, never remove', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: { deploymentStop: true } }));
    await new RailwayProvider('key', 'account', true, fetcher).stop(ref, command);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ query: 'mutation deploymentStop($id: String!) { deploymentStop(id: $id) }', variables: { id: ref.id } });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer key' });
  });
  it('rejects GraphQL errors in HTTP 200 instead of marking success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ errors: [{ message: 'secret' }], data: { deploymentStop: true } }));
    await expect(new RailwayProvider('key', 'project', true, fetcher).stop(ref, command)).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('restarts a sleeping deployment after lifecycle gate and refuses removed deployments', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: { deployment: { id: ref.id, status: 'SLEEPING' } } })).mockResolvedValueOnce(json({ data: { deploymentRestart: true } })).mockResolvedValueOnce(json({ data: { deployment: { id: ref.id, status: 'REMOVED' } } }));
    const provider = new RailwayProvider('key', 'project', true, fetcher);
    await provider.wake(ref, command);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).query).toContain('deploymentRestart');
    await expect(provider.wake(ref, command)).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('Sprites native Tasks client', () => {
  const now = Date.parse('2026-09-10T00:00:00Z');
  const hold = { id: 'gateway-epoch-1', expiresAt: now + 300_000 };
  const receipt = { name: hold.id, expires_at: '2026-09-10T00:05:00Z' };
  it('upserts through local socket and confirms expiry with readback', async () => {
    const transport = vi.fn<SpritesTaskTransport>().mockResolvedValueOnce({ status: 200 }).mockResolvedValueOnce({ status: 200, body: receipt });
    expect(await new SpritesTasksClient(transport, () => now).hold(hold)).toEqual({ name: hold.id, expiresAt: hold.expiresAt });
    expect(transport.mock.calls[0]?.[0]).toEqual({ socketPath: '/.sprite/api.sock', host: 'sprite', method: 'PUT', path: '/v1/tasks/gateway-epoch-1', body: { expire: 300 } });
    expect(transport.mock.calls[1]?.[0].method).toBe('GET');
  });
  it('rounds outward for whole-second provider expiry without relaxing deadline confirmation', async () => {
    const clock = now + 558;
    let seconds = 0;
    const transport = vi.fn<SpritesTaskTransport>(async request => {
      if (request.method === 'PUT') { seconds = request.body!.expire; return { status: 200 }; }
      return { status: 200, body: { name: hold.id, expires_at: new Date(now + seconds * 1000).toISOString() } };
    });
    const client = new SpritesTasksClient(transport, () => clock);
    expect(await client.hold({ ...hold, expiresAt: clock + 30000 })).toEqual({ name: hold.id, expiresAt: now + 31000 });
    expect(seconds).toBe(31);
    await expect(client.hold({ ...hold, expiresAt: clock + 3600000 })).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(seconds).toBe(3600);
  });
  it.each([now - 1, now, now + 3600_001, Number.NaN])('rejects invalid expiry %s without native call', async (expiresAt) => {
    const transport = vi.fn<SpritesTaskTransport>();
    await expect(new SpritesTasksClient(transport, () => now).hold({ ...hold, expiresAt })).rejects.toMatchObject({ code: 'invalid_ref' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not trust a successful upsert with absent or insufficient readback', async () => {
    const transport = vi.fn<SpritesTaskTransport>().mockResolvedValueOnce({ status: 200 }).mockResolvedValueOnce({ status: 404 });
    await expect(new SpritesTasksClient(transport, () => now).hold(hold)).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('release confirms absence but cannot claim VM termination', async () => {
    const transport = vi.fn<SpritesTaskTransport>().mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({ status: 404 });
    await new SpritesTasksClient(transport, () => now).release(hold.id);
    expect(transport.mock.calls.map(([request]) => request.method)).toEqual(['DELETE', 'GET']);
  });
  it('release fails when task is still present', async () => {
    const transport = vi.fn<SpritesTaskTransport>().mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({ status: 200, body: receipt });
    await expect(new SpritesTasksClient(transport, () => now).release(hold.id)).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('binds native holds to the configured Sprite identity', async () => {
    const transport = vi.fn<SpritesTaskTransport>();
    const provider = new SpritesProvider('key', 'gateway', true, fetch, () => now, { runtimeId: 'sprite-1', client: new SpritesTasksClient(transport, () => now) });
    expect(provider.capabilities.activityHold).toBe('native');
    await expect(provider.holdActivity({ provider: 'fly-sprites', id: 'sprite-2' }, hold)).rejects.toMatchObject({ code: 'invalid_ref' });
    expect(transport).not.toHaveBeenCalled();
    expect(provider.capabilities.confirmedStop).toBe(false);
  });
});

describe('factory fetch binding', () => {
  it('calls fetch the way workerd accepts (unbound, no redirect:error)', async () => {
    const original = globalThis.fetch;
    const strict = vi.fn(function (this: unknown, _input: unknown, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      if (init?.redirect === 'error') throw new TypeError('Invalid redirect value');
      return Promise.resolve(new Response(JSON.stringify({ name: 'demo', status: 'cold' }), { status: 200 }));
    });
    globalThis.fetch = strict as unknown as typeof fetch;
    try {
      const provider = createProvider({ provider: 'fly-sprites', token: 'token', service: 'hehebot' });
      await expect(provider.observe({ provider: 'fly-sprites', id: 'demo' })).resolves.toMatchObject({ executionPaused: true });
      expect(strict).toHaveBeenCalledOnce();
    } finally { globalThis.fetch = original; }
  });
});
