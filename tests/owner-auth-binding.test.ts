import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { bindOwnerAuth, type AuthConfig } from '../src/worker/auth';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';
import { exportControl } from '../src/core/control-export';
import { importControlExport } from '../scripts/import-control-export.mjs';
import { TestDatabase } from './helpers';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

const access = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  AUTH_MODE: 'access',
  INSTALLATION_ID: 'installation-43',
  ACCESS_ISSUER: 'https://owner-team.cloudflareaccess.com',
  ACCESS_AUD: 'portal-audience-71',
  OWNER_SUB: 'owner-subject-29',
  ...overrides,
});
const expectedBinding = (config: AuthConfig) => JSON.stringify({
  auth_mode: config.AUTH_MODE,
  installation_id: config.INSTALLATION_ID,
  issuer: config.ACCESS_ISSUER,
  audience: config.ACCESS_AUD,
  owner_subject: config.OWNER_SUB,
});
const ownerRows = (db: TestDatabase) => db.all<{ value_json: string }>(
  "SELECT value_json FROM runtime_metadata WHERE key='installation_owner'",
);

function construct(db: TestDatabase, auth: AuthConfig) {
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
        const rows = db.all(sql, ...values);
        return { toArray: () => rows };
      } },
      transactionSync: <T>(fn: () => T) => db.transaction(fn),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
  };
  const env = {
    ...auth,
    EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}',
    ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
  } as unknown as Env;
  const control = new PersonalControl(ctx as unknown as DurableObjectState, env);
  return { control, initialized };
}

const databases: TestDatabase[] = [];
const database = () => { const db = new TestDatabase(); databases.push(db); return db; };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

it('binds the exact Access owner on fresh data and reconstructs idempotently before seeding', async () => {
  const db = database(), config = access();
  const first = construct(db, config);
  await first.initialized;
  expect(ownerRows(db)).toEqual([{ value_json: expectedBinding(config) }]);
  const seeded = db.all('SELECT * FROM objects ORDER BY id');
  expect(seeded.length).toBeGreaterThan(0);

  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  const second = construct(db, config);
  await second.initialized;
  expect(ownerRows(db)).toEqual([{ value_json: expectedBinding(config) }]);
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(db.all('SELECT * FROM objects ORDER BY id')).toEqual(seeded);
});

it('exposes only the stable binding digest on runtime-authenticated status', async () => {
  const db = database(), config = access(), first = construct(db, config);
  await first.initialized;
  const env = { ...config, RUNTIME_TOKEN: 'runtime-secret-19', CONTROL: { getByName: () => first.control } } as unknown as Env;
  const request = (token: string) => worker.fetch(new Request('https://portal.example/internal/status', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}',
  }), env);
  expect((await request('wrong-token')).status).toBe(401);
  const response = await request('runtime-secret-19');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ phase: 'STOPPED', epoch: 0, execution_enabled: false,
    owner_binding_sha256: 'd167d266bdd34b51eb916816899830e9810c2d32283e61ebd0a6b5dc7bfe7897' });
  const second = construct(db, config); await second.initialized;
  expect(await second.control.runtime({ type: 'status', payload: {} })).toEqual(await first.control.runtime({ type: 'status', payload: {} }));
  expect(JSON.stringify((await first.control.getState(config.OWNER_SUB)))).not.toContain('owner_binding_sha256');
});

it('leaves the local runtime status shape unchanged', async () => {
  const local = construct(database(), access({ AUTH_MODE: 'local', INSTALLATION_ID: 'local-only' }));
  await local.initialized;
  expect(await local.control.runtime({ type: 'status', payload: {} })).toEqual({ ok: true,
    value: { phase: 'STOPPED', epoch: 0, execution_enabled: false } });
});

it.each([
  ['owner', { OWNER_SUB: 'different-owner' }],
  ['issuer', { ACCESS_ISSUER: 'https://other-team.cloudflareaccess.com' }],
  ['audience', { ACCESS_AUD: 'different-audience' }],
  ['installation', { INSTALLATION_ID: 'different-installation' }],
  ['local downgrade', { AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', ACCESS_ISSUER: '', ACCESS_AUD: '', OWNER_SUB: '' }],
] as const)('rejects changed %s without overwriting the binding or private data', async (_name, changes) => {
  const db = database(), config = access();
  await construct(db, config).initialized;
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('private-canary',?)", JSON.stringify({ secret: 'PRIVATE_CANARY_83' }));
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');

  await expect(construct(db, { ...config, ...changes }).initialized).rejects.toMatchObject({ code: 'OWNER_MIGRATION_REQUIRED' });
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(db.all("SELECT value_json FROM runtime_metadata WHERE key='private-canary'")).toEqual([
    { value_json: JSON.stringify({ secret: 'PRIVATE_CANARY_83' }) },
  ]);
});

it('refuses first Access adoption of populated unbound data without reassigning it', () => {
  const db = database();
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('private-canary',?)", JSON.stringify({ secret: 'PRIVATE_CANARY_97' }));
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  expect(() => bindOwnerAuth(db, access())).toThrowError(expect.objectContaining({ code: 'OWNER_MIGRATION_REQUIRED' }));
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it('refuses unbound private objects even when no runtime metadata or commands exist', () => {
  const db = database();
  db.exec("INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES('private-object-43','memory',1,?, '2026-09-16T00:00:00Z','2026-09-16T00:00:00Z')", JSON.stringify({ text: 'PRIVATE_OBJECT_71' }));
  const before = db.all('SELECT * FROM objects');
  expect(() => bindOwnerAuth(db, access())).toThrowError(expect.objectContaining({ code: 'OWNER_MIGRATION_REQUIRED' }));
  expect(db.all('SELECT * FROM objects')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it('leaves existing unbound local-only data unchanged', () => {
  const db = database();
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('local-canary','\"LOCAL_PRIVATE_19\"')");
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  bindOwnerAuth(db, access({ AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', ACCESS_ISSUER: '', ACCESS_AUD: '', OWNER_SUB: '' }));
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it.each([
  { ACCESS_ISSUER: 'http://owner-team.cloudflareaccess.com' },
  { ACCESS_ISSUER: 'https://example.com' },
  { ACCESS_AUD: '' },
  { OWNER_SUB: '' },
  { INSTALLATION_ID: '' },
])('does not write for invalid fresh Access configuration %#', changes => {
  const db = database(), before = db.all('SELECT * FROM runtime_metadata');
  expect(() => bindOwnerAuth(db, access(changes))).toThrowError(expect.objectContaining({ code: 'AUTH_CONFIGURATION_REQUIRED' }));
  expect(db.all('SELECT * FROM runtime_metadata')).toEqual(before);
});

it('retains the installation owner through application export and import', async () => {
  const db = database(), config = access();
  bindOwnerAuth(db, config);
  const directory = await mkdtemp(join(tmpdir(), 'hehe-owner-binding-'));
  const input = join(directory, 'control-export.json'), destination = join(directory, 'restored');
  try {
    await writeFile(input, exportControl(db, '2026-09-16T00:00:00.000Z'), { mode: 0o600 });
    expect(await importControlExport(input, destination)).toMatchObject({ status: 'verified', activation_allowed: false });
    const restored = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
    try {
      expect(restored.prepare("SELECT value_json FROM runtime_metadata WHERE key='installation_owner'").all()).toEqual([
        { value_json: expectedBinding(config) },
      ]);
    } finally { restored.close(); }
    expect(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))).toMatchObject({ counts: { runtime_metadata: 1 } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
