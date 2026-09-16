import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AGENT_TOOL_NAMES, readAccessCredentials } from './agent-tools.mjs';
import { ControlClient } from './control-client.mjs';
import { FileJournal } from './file-journal.mjs';
import { CodexAdapter, PINNED_CODEX, RESTRICTED_CODEX_FEATURES } from './codex-adapter.mjs';
import { CodexEventRouter } from './codex-events.mjs';
import { CodexTaskControl } from './codex-tasks.mjs';
import { CodexOperations } from './codex-operations.mjs';
import { spawnCodex } from './codex-transport.mjs';
import { CodexQuestionBinding } from './codex-questions.mjs';
import { ExecutionSupervisor } from './execution-supervisor.mjs';
import { SpritesActivityGuard } from './sprites-activity-guard.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const privatePath = async (path, directory = false) => {
  if (!isAbsolute(path)) fail('PRIVATE_PATH_REQUIRED');
  const info = await lstat(path);
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink() ||
      info.uid !== process.getuid() || (info.mode & 0o077) !== 0) fail('PRIVATE_PATH_REQUIRED');
};

/** Composition boundary, not production admission. The caller must hold the
 * kernel executor lock for the entire process tree. Existing state is recovery
 * evidence, never permission to boot, replay work, or replace a live executor.
 * The production HTTP entrypoint deliberately remains transport-preflight-only.
 */
export function createCodexService(config, dependencies) {
  config = structuredClone(config);
  const { tasks, fetchImpl, prepareNative = async () => {},
    launch = spawnCodex, now = Date.now, onRecovery = () => {},
    checkVersion = async binary => {
      const result = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
      if (result.stdout.trim() !== `codex-cli ${PINNED_CODEX}`) fail('CODEX_VERSION_MISMATCH');
    } } = dependencies;
  let phase = 'stopped', journal, control, transport, adapter, router, supervisor, activity;
  let ownsIntent = false, stopping, questions, questionNotification, admission;
  let alpha = null;
  const hosted = Object.hasOwn(config, 'hostedOwnerBindingSha256');
  const taskControllers = new Map();
  const assertStarting = () => {
    if (phase !== 'starting') fail('SERVICE_RECOVERY_REQUIRED');
  };
  const starting = async action => {
    // Check before invoking, not after an eagerly evaluated side effect. A stop
    // can run between the previous helper's resolution and its caller resuming.
    assertStarting();
    const result = await action();
    assertStarting();
    return result;
  };
  const operations = dependencies.operations ?? (async () => {
    if (!supervisor) return [];
    const snapshots = [];
    for (const row of await supervisor.bridge.families()) {
      if (!row.nativeRunId || row.phase === 'complete') continue;
      snapshots.push(...await new CodexOperations({ journal, attemptId: row.attemptId, runId: row.claim.run.id,
        attempt: row.claim.run.current_attempt, startedAt: row.claim.run.updated_at,
        deadlineAt: row.claim.deadline_at }).snapshot());
    }
    return snapshots;
  });
  const recover = () => {
    if (phase === 'recovery') return;
    phase = 'recovery'; questions?.close(); supervisor?.disconnect();
    onRecovery({ code: 'SERVICE_RECOVERY_REQUIRED' });
  };
  const admit = () => {
    if (admission) return admission;
    admission = (async () => {
      await router.flush();
      await supervisor.serialized(async () => {
        supervisor.assertLease();
        const row = await journal.get(supervisor.bridge.cursor);
        if (row?.attemptId && ['running', 'released'].includes(row.phase)) {
          const native = await adapter.requireRun(row.attemptId);
          if (native.rootSettled) {
            await supervisor.bridge.releaseCoordinator({ ...native, attemptId: row.attemptId });
            supervisor.assertLease();
          }
        }
      });
      return supervisor.dispatch();
    })().catch(error => { recover(); throw error; }).finally(() => { admission = null; });
    return admission;
  };
  const service = {
    get phase() { return phase; },
    get supervisor() { return supervisor; },
    get adapter() { return adapter; },
    get journal() { return journal; },
    async start() {
      if (phase !== 'stopped') fail('SERVICE_ALREADY_STARTED');
      // Hosted composition requires a pinned owner and real activity custody.
      // This does not enable hosted alpha admission in the control plane.
      if (hosted && (typeof config.hostedOwnerBindingSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(config.hostedOwnerBindingSha256) || config.ownerAlpha === undefined ||
          typeof config.accessClientIdFile !== 'string' || typeof config.accessClientSecretFile !== 'string' ||
          typeof tasks?.hold !== 'function' || typeof tasks?.release !== 'function')) fail('INVALID_SERVICE_CONFIGURATION');
      // Supervised alpha is explicit and separate from test/production gates.
      if (config.ownerAlpha !== undefined) {
        alpha = ownerAlphaPolicy(config.ownerAlpha);
        const remaining = Date.parse(alpha.expires_at) - now();
        let origin; try { origin = new URL(config.portalOrigin); } catch { fail('INVALID_SERVICE_CONFIGURATION'); }
        if (config.disposableTest === true || remaining <= 0 || remaining > 300000 ||
            !hosted && !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) ||
            Object.keys(config.personas ?? {}).length !== 1 || !config.personas?.[alpha.persona_id] ||
            config.ownerQuestions === true || config.restrictedPermissions === false) fail('INVALID_SERVICE_CONFIGURATION');
        config.restrictedPermissions = true;
      } else if (config.disposableTest !== true) fail('NATIVE_COMPATIBILITY_GATE_BLOCKED');
      if (Object.keys(config).some(key => !['disposableTest', 'stateDirectory', 'binary', 'portalOrigin',
        'runtimeTokenFile', 'tlsCAFile', 'installationId', 'personas', 'accessClientIdFile', 'accessClientSecretFile', 'ownerQuestions', 'restrictedPermissions', 'ownerAlpha', 'nativeHome', 'hostedOwnerBindingSha256'].includes(key)) ||
        config.nativeHome !== undefined && (!alpha || typeof config.nativeHome !== 'string' || !isAbsolute(config.nativeHome)) ||
        config.ownerQuestions !== undefined && typeof config.ownerQuestions !== 'boolean' ||
        config.restrictedPermissions !== undefined && typeof config.restrictedPermissions !== 'boolean') fail('INVALID_SERVICE_CONFIGURATION');
      if (!alpha && (!tasks?.hold || !tasks?.release) || typeof operations !== 'function' ||
          !isAbsolute(config.binary) || !config.personas || !isAbsolute(config.stateDirectory)) fail('INVALID_SERVICE_CONFIGURATION');
      for (const persona of Object.values(config.personas)) {
        if (!Array.isArray(persona.allowedTools) || new Set(persona.allowedTools).size !== persona.allowedTools.length ||
            persona.allowedTools.some(tool => !AGENT_TOOL_NAMES.includes(tool))) fail('INVALID_SERVICE_CONFIGURATION');
        if (config.restrictedPermissions && persona.allowedTools.some(tool => !['hehebot_list_routines', 'hehebot_read_skill'].includes(tool))) fail('INVALID_SERVICE_CONFIGURATION');
      }
      phase = 'starting';
      try {
        await starting(() => privatePath(config.stateDirectory, true));
        await starting(() => privatePath(config.runtimeTokenFile));
        const token = (await starting(() => readFile(config.runtimeTokenFile, 'utf8'))).trim();
        const access = await starting(() => readAccessCredentials(config));
        const configuredControl = new ControlClient({ origin: config.portalOrigin, token, fetchImpl, ...access });
        control = dependencies.control ?? configuredControl;
        journal = new FileJournal(join(config.stateDirectory, 'journal'));
        const bootId = randomUUID();
        assertStarting();
        if (await journal.putIfAbsent('service', { phase: 'boot_unknown', bootId, ...(alpha ? { ownerAlpha: alpha } : {}),
          ...(hosted ? { hostedOwner: { bindingSha256: config.hostedOwnerBindingSha256,
            origin: new URL(config.portalOrigin).origin } } : {}) })) fail('SERVICE_RECOVERY_REQUIRED');
        ownsIntent = true;
        assertStarting();
        const status = await starting(() => control.request('status', {}));
        if (hosted && status?.owner_binding_sha256 !== config.hostedOwnerBindingSha256) fail('OWNER_BINDING_MISMATCH');
        if (alpha) {
          if (status?.phase !== 'STOPPED' || status.epoch !== 0 || status.execution_enabled !== false ||
              JSON.stringify(ownerAlphaPolicy(status.owner_alpha)) !== JSON.stringify(alpha)) fail('CONTROL_NOT_BOOTABLE');
        } else if (status?.phase !== 'BOOTING' || status.execution_enabled !== true || !Number.isSafeInteger(status.epoch)) fail('CONTROL_NOT_BOOTABLE');
        const identity = await starting(() => control.request('boot', { boot_id: bootId }));
        if (identity?.epoch !== (alpha ? 1 : status.epoch) || identity.boot_id !== bootId) fail('INVALID_BOOT_IDENTITY');
        await starting(() => journal.update('service', { phase: 'starting', identity }));
        // Only local supervised execution has no provider hold. Hosted alpha
        // retains the provider Task on stop/uncertainty; it cannot prove sleep.
        activity = alpha && !hosted ? { ensure: async () => {}, releaseAfterDrain: async () => fail('OWNER_ALPHA_SLEEP_DENIED') }
          : new SpritesActivityGuard({ tasks, id: `hehe-${identity.epoch}-${bootId}`, now, onUnsafe: recover });
        await starting(() => activity.ensure());
        await starting(() => checkVersion(config.binary));
        const home = config.nativeHome ?? join(config.stateDirectory, 'codex-home'), workspace = join(config.stateDirectory, 'workspace');
        if (config.nativeHome) await starting(() => privatePath(home, true));
        else if (alpha) {
          await starting(() => mkdir(home, { mode: 0o700, recursive: true }));
          await starting(() => privatePath(home, true));
        } else await starting(() => mkdir(home, { mode: 0o700 }));
        await starting(() => mkdir(workspace, { mode: 0o700 }));
        if (hosted) await starting(() => activity.ensure());
        await starting(() => prepareNative(home));
        const configOverrides = config.restrictedPermissions ? {
          web_search: 'disabled',
          ...Object.fromEntries(Object.entries(RESTRICTED_CODEX_FEATURES).map(([key, value]) => [`features.${key}`, value])),
          ...(alpha ? { 'agents.enabled': false, 'features.multi_agent': false, 'features.multi_agent_v2': false } : {}),
        } : {};
        let permissions;
        if (config.restrictedPermissions) {
          const path = join(home, 'config.toml');
          let base = '';
          try {
            await starting(() => privatePath(path));
            base = await starting(() => readFile(path, 'utf8'));
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          const filesystem = { ':minimal': 'read', [workspace]: 'read',
            [join(config.stateDirectory, 'journal')]: 'deny', [home]: 'deny',
            ...Object.fromEntries([config.runtimeTokenFile, config.accessClientIdFile, config.accessClientSecretFile]
              .filter(Boolean).map(path => [path, 'deny'])) };
          const digest = createHash('sha256').update(JSON.stringify({ base, filesystem, network: { enabled: false }, configOverrides })).digest('hex');
          const name = `hehebot-restricted-${digest}`;
          const contents = `default_permissions = ${JSON.stringify(name)}\n${base}\n[permissions.${name}.filesystem]\n` +
            Object.entries(filesystem).map(([path, mode]) => `${JSON.stringify(path)} = ${JSON.stringify(mode)}\n`).join('') +
            `[permissions.${name}.network]\nenabled = false\n`;
          permissions = { name, filesystem, configSha256: createHash('sha256').update(config.nativeHome ? base : contents).digest('hex') };
          if (config.nativeHome) {
            // Preserve the owner's config and credential-store selection in place.
            configOverrides.default_permissions = name;
            configOverrides[`permissions.${name}`] = { filesystem, network: { enabled: false } };
          } else await starting(() => writeFile(path, contents, { mode: 0o600 }));
          // Journal only the digest/identity, never provider configuration text.
          await starting(() => journal.update('service', { permissions: { name, configSha256: permissions.configSha256 } }));
        }
        assertStarting();
        if (config.ownerQuestions === true) questions = new CodexQuestionBinding({ journal, control, timeoutMs: 300000,
          resolveBinding: async ({ threadId, turnId }) => {
            // A server question can precede the turn/start reply and Worker ACK.
            // Wait only for that same in-flight admission; never infer its success.
            for (let tries = 0; tries < 400; tries++) {
              if (!['starting', 'running'].includes(phase) || !supervisor) return null;
              supervisor.assertLease();
              const families = await supervisor.bridge.families();
              let row, nativeRow;
              for (const candidate of families) {
                const native = await journal.get(candidate.attemptId);
                if (native?.threadId === threadId) { row = candidate; nativeRow = native; break; }
              }
              if (!row || nativeRow.nativeRunId && nativeRow.nativeRunId !== turnId) return null;
              if (row.phase === 'running') {
                supervisor.assertLease();
                if (row.nativeRunId !== turnId) return null;
                return { identity, run_id: row.claim.run.id, attempt: row.claim.run.current_attempt,
                  attemptId: row.attemptId, deadline_at: row.claim.deadline_at };
              }
              if (!['submission_unknown', 'submitted_unknown'].includes(row.phase)) return null;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            return null;
          } });
        if (hosted) await starting(() => activity.ensure());
        transport = launch({ binary: config.binary, home, cwd: workspace, timeoutMs: 10000, configOverrides,
          ...(questions ? { onUserInput: questions.onUserInput, userInputTimeoutMs: 300000 } : {}) });
        if (questions) {
          questionNotification = message => { void questions.onNotification(message).catch(recover); };
          transport.on('notification', questionNotification);
          transport.on('disconnect', recover);
        }
        // Native diagnostics may contain task data; callers must not log them.
        transport.child.stderr?.resume();
        await starting(() => transport.initialize({ experimentalApi: Boolean(permissions) }));
        if (permissions) {
          const readback = await starting(() => transport.request('config/read', { includeLayers: false, cwd: workspace }));
          const profile = readback?.config?.permissions?.[permissions.name];
          if (Object.entries(configOverrides).some(([key, value]) => {
            if (key.startsWith('permissions.')) return false;
            const actual = key.split('.').reduce((node, part) => node?.[part], readback?.config);
            // Native merging preserves a configured sleep mode when disabling it.
            return key === 'features.sleep_tool' ? actual !== false && actual?.enabled !== false : actual !== value;
          })) fail('RESTRICTED_PROFILE_MISMATCH');
          if (Object.keys(readback?.config?.mcp_servers ?? {}).length) fail('RESTRICTED_PROFILE_MISMATCH');
          if (readback?.config?.default_permissions !== permissions.name || profile?.network?.enabled !== false ||
              !profile.filesystem || Object.keys(profile.filesystem).some(key =>
                !Object.hasOwn(permissions.filesystem, key) && !(key === 'glob_scan_max_depth' && profile.filesystem[key] === null)) ||
              Object.entries(permissions.filesystem).some(([path, mode]) => profile.filesystem[path] !== mode) ||
              profile.extends != null || profile.workspace_roots != null) fail('RESTRICTED_PROFILE_MISMATCH');
        }
        assertStarting();
        adapter = new CodexAdapter({ journal, cwd: workspace, rpc: (method, params) => transport.request(method, params),
          testMode: !alpha, ownerAlpha: alpha, now, permissionsProfile: permissions?.name });
        const native = {
          admissionReadiness: () => adapter.admissionReadiness(),
          sleepReadiness: () => adapter.sleepReadiness(),
          cancel: id => adapter.cancel(id),
          submit: async input => {
            input = { ...input };
            const background = Object.hasOwn(input, 'ownerAlphaBackground');
            if (background && (input.ownerAlphaBackground !== true || alpha?.background_first_root !== true)) fail('OWNER_ALPHA_ADMISSION_DENIED');
            supervisor.assertLease();
            if (permissions) {
              const contents = await readFile(join(home, 'config.toml')).catch(error => {
                if (config.nativeHome && error.code === 'ENOENT') return '';
                throw error;
              });
              if (createHash('sha256').update(contents).digest('hex') !== permissions.configSha256) fail('RESTRICTED_PROFILE_CHANGED');
              supervisor.assertLease();
            }
            const row = await journal.get(supervisor.bridge.cursor);
            if (row?.attemptId !== input.attemptId || !row.claim?.run) fail('CLAIM_IDENTITY_MISMATCH');
            if (Object.hasOwn(row.claim, 'owner_alpha_background') !== background ||
                Object.hasOwn(row.claim, 'owner_alpha_background') && row.claim.owner_alpha_background !== true) fail('OWNER_ALPHA_ADMISSION_DENIED');
            const run = row.claim.run, persona = config.personas[run.persona_id];
            if (!persona) fail('NATIVE_PERSONA_UNMAPPED');
            if (alpha) {
              const deadline = Date.parse(row.claim.deadline_at), context = JSON.parse(run.context_json);
              if (!Number.isFinite(deadline) || now() >= Date.parse(alpha.expires_at) || deadline <= now() ||
                  deadline > Date.parse(alpha.expires_at) || deadline > now() + alpha.max_task_seconds * 1000 ||
                  run.persona_id !== alpha.persona_id || run.current_attempt !== 1 || run.routine_id || context.room_id ||
                  run.role !== 'coordinator' || (await supervisor.bridge.families()).length > alpha.max_runs) fail('OWNER_ALPHA_ADMISSION_DENIED');
            }
            const grant = { origin: config.portalOrigin, tokenFile: config.runtimeTokenFile,
              ...(config.accessClientIdFile ? { accessClientIdFile: config.accessClientIdFile, accessClientSecretFile: config.accessClientSecretFile } : {}),
              identity, runId: run.id, attempt: run.current_attempt, allowedTools: persona.allowedTools };
            // Write once, fsync, never rewrite an admitted grant in place.
            const key = `grant-${input.attemptId}`;
            const existing = await journal.putIfAbsent(key, grant);
            if (existing && JSON.stringify(existing) !== JSON.stringify(grant)) fail('TASK_GRANT_CONFLICT');
            supervisor.assertLease();
            const mcpServers = { hehebot: {
              command: process.execPath, args: [fileURLToPath(new URL('./agent-tools.mjs', import.meta.url))],
              env: { HEHEBOT_AGENT_TOOLS_CONFIG: journal.path(key),
                ...(config.tlsCAFile ? { NODE_EXTRA_CA_CERTS: config.tlsCAFile } : {}) },
              tools: Object.fromEntries(persona.allowedTools.map(name => [name, { approval_mode: 'approve' }])),
              ...(permissions ? { enabled_tools: persona.allowedTools } : {}),
            } };
            // Fresh service-owned native home has no inherited global MCP config.
            return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, testMode: !alpha,
              ownerAlpha: alpha ? { ...alpha, expires_at: row.claim.deadline_at } : null, now, mcpServers,
              permissionsProfile: permissions?.name }).submit(input);
          },
        };
        router = new CodexEventRouter({ transport, adapter, onRecovery: recover, now });
        const eachController = async action => {
          for (const row of await supervisor.bridge.families()) {
            if (!row.nativeRunId || row.phase === 'complete') continue;
            if (!taskControllers.has(row.attemptId)) {
              taskControllers.set(row.attemptId, new CodexTaskControl({ adapter, control, journal, identity, attemptId: row.attemptId,
                parent: { runId: row.claim.run.id, personaId: row.claim.run.persona_id, attempt: row.claim.run.current_attempt },
                assertLease: () => supervisor.assertLease() }));
            }
            await action(taskControllers.get(row.attemptId));
          }
        };
        supervisor = new ExecutionSupervisor({ control, native, journal, identity, installationId: config.installationId,
          personas: config.personas, events: router, activity, operations, now, onRecovery: recover,
          admission: admit,
          children: { sync: () => eachController(controller => controller.sync()), cancel: ids => eachController(controller => controller.cancel(ids)),
            steer: () => eachController(controller => controller.steer()), publishOutputs: () => eachController(controller => controller.publishOutputs()) } });
        await starting(() => control.request('ready', { identity }));
        const dispatched = await starting(() => supervisor.start());
        if (supervisor.phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
        await starting(() => journal.update('service', { phase: 'running' }));
        assertStarting();
        phase = 'running';
        return dispatched;
      } catch (error) {
        recover(); await service.stop();
        fail(error.code === 'NATIVE_COMPATIBILITY_GATE_BLOCKED' ? error.code : 'SERVICE_RECOVERY_REQUIRED');
      }
    },
    async observe(attemptId = undefined) {
      await router?.flush();
      const cursor = supervisor && await journal.get(supervisor.bridge.cursor);
      if (attemptId !== undefined) {
        if (!(await supervisor.bridge.families()).some(row => row.attemptId === attemptId)) fail('UNKNOWN_ATTEMPT');
        return adapter.requireRun(attemptId);
      }
      const latest = cursor?.attemptId ?? (supervisor && (await supervisor.bridge.families()).at(-1)?.attemptId);
      return latest ? adapter.requireRun(latest) : null;
    },
    async maintain() {
      if (phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
      await router.flush();
      await supervisor.maintain();
      return admit();
    },
    stop() {
      return stopping ??= (async () => {
        phase = 'recovery';
        questions?.close();
        if (questionNotification) { transport?.off('notification', questionNotification); transport?.off('disconnect', recover); }
        supervisor?.disconnect(); router?.close(); transport?.close();
        if (router) await router.tail;
        if (transport) {
          const exited = () => transport.child.exitCode !== null || transport.child.signalCode !== null;
          const wait = async () => { for (let i = 0; i < 100 && !exited(); i++) await new Promise(ok => setTimeout(ok, 25)); };
          await wait();
          if (!exited()) { transport.child.kill('SIGKILL'); await wait(); }
          if (!exited()) fail('NATIVE_STOP_UNCONFIRMED');
        }
        if (supervisor) { await supervisor.work; await supervisor.maintenance?.catch(() => {}); }
        await admission?.catch(() => {});
        if (ownsIntent) await journal.update('service', { phase: 'recovery', nativeStopped: true });
        phase = 'recovery';
        // Intentionally no complete/commit-sleep or activity release on shutdown.
        // Unknown effects and the durable state survive for explicit reconciliation.
      })();
    },
  };
  return service;
}
