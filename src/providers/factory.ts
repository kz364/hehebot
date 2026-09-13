import { DaytonaProvider } from './daytona';
import { FakeProvider } from './fake';
import { FlyMachinesProvider } from './fly-machines';
import { E2BProvider, type E2BSdkPort } from './e2b';
import { SpritesProvider } from './sprites';
import { createE2BHttpClient } from './e2b-http';
import { RailwayProvider } from './railway';
import { ProviderError, type ProviderId, type RuntimeProvider, type RuntimeRef } from './index';
/** Construct privately from bindings; never persist this token-bearing object. */
export interface ProviderConfig { readonly provider: ProviderId; readonly ref?: RuntimeRef; readonly token?: string; readonly service?: string; readonly lifecycleVerified?: boolean; readonly tokenKind?: 'project' | 'account'; readonly wakeUrl?:string; readonly wakeToken?:string }
export function createProvider(config: ProviderConfig, fetcher: typeof fetch = fetch, clients?: { e2b?: E2BSdkPort }): RuntimeProvider {
  switch (config.provider) {
    case 'fake': return new FakeProvider();
    case 'fly-machines': return new FlyMachinesProvider(config.token ?? '', fetcher);
    case 'daytona': return new DaytonaProvider(config.token ?? '', fetcher);
    case 'fly-sprites': return new SpritesProvider(config.token ?? '', config.service, config.lifecycleVerified, fetcher, Date.now, undefined, config.wakeUrl?{url:config.wakeUrl,token:config.wakeToken??''}:undefined);
    case 'e2b': return new E2BProvider(clients?.e2b ?? createE2BHttpClient(config.token ?? '', fetcher), config.lifecycleVerified);
    case 'railway': return new RailwayProvider(config.token ?? '', config.tokenKind, config.lifecycleVerified, fetcher);
    default: throw new ProviderError('unconfigured', 'Unknown runtime provider');
  }
}
