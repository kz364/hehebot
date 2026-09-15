import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AGENT_TOOL_NAMES, readAccessCredentials } from './agent-tools.mjs';
import { ControlClient } from './control-client.mjs';
import { FileJournal } from './file-journal.mjs';
import { CodexAdapter, PINNED_CODEX } from './codex-adapter.mjs';
import { CodexEventRouter } from './codex-events.mjs';
import { CodexTaskControl } from './codex-tasks.mjs';
import { CodexOperations } from './codex-operations.mjs';
import { spawnCodex } from './codex-transport.mjs';
import { CodexQuestionBinding } from './codex-questions.mjs';
import { ExecutionSupervisor } from './execution-supervisor.mjs';
import { SpritesActivityGuard } from './sprites-activity-guard.mjs';

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
  let ownsIntent = false, stopping, currentTasks, currentAttempt, questions, questionNotification;
  const starting = async promise => {
    const result = await promise;
    if (phase !== 'starting') fail('SERVICE_RECOVERY_REQUIRED');
    return result;
  };
  const operations = dependencies.operations ?? (async () => {
    if (!supervisor) return [];
    const row = await journal.get(supervisor.bridge.cursor);
    if (!row?.attemptId || !row.claim) return [];
    return new CodexOperations({ journal, attemptId: row.attemptId, runId: row.claim.run.id,
      attempt: row.claim.run.current_attempt, startedAt: row.claim.run.updated_at,
      deadlineAt: row.claim.deadline_at }).snapshot();
  });
  const recover = () => {
    if (phase === 'recovery') return;
    phase = 'recovery'; questions?.close(); supervisor?.disconnect();
    onRecovery({ code: 'SERVICE_RECOVERY_REQUIRED' });
  };
  const service = {
    get phase() { return phase; },
    get supervisor() { return supervisor; },
    get adapter() { return adapter; },
    get journal() { return journal; },
    async start() {
      if (phase !== 'stopped') fail('SERVICE_ALREADY_STARTED');
      // No environment variable or persisted compatibility flag enables this.
      if (config.disposableTest !== true) fail('NATIVE_COMPATIBILITY_GATE_BLOCKED');
      if (Object.keys(config).some(key => !['disposableTest', 'stateDirectory', 'binary', 'portalOrigin',
        'runtimeTokenFile', 'tlsCAFile', 'installationId', 'personas', 'accessClientIdFile', 'accessClientSecretFile', 'ownerQuestions'].includes(key)) ||
        config.ownerQuestions !== undefined && typeof config.ownerQuestions !== 'boolean') fail('INVALID_SERVICE_CONFIGURATION');
      if (!tasks?.hold || !tasks?.release || typeof operations !== 'function' ||
          !isAbsolute(config.binary) || !config.personas || !isAbsolute(config.stateDirectory)) fail('INVALID_SERVICE_CONFIGURATION');
      for (const persona of Object.values(config.personas)) {
        if (!Array.isArray(persona.allowedTools) || new Set(persona.allowedTools).size !== persona.allowedTools.length ||
            persona.allowedTools.some(tool => !AGENT_TOOL_NAMES.includes(tool))) fail('INVALID_SERVICE_CONFIGURATION');
      }
      phase = 'starting';
      try {
        await privatePath(config.stateDirectory, true);
        await privatePath(config.runtimeTokenFile);
        const token = (await readFile(config.runtimeTokenFile, 'utf8')).trim();
        const access = await readAccessCredentials(config);
        const configuredControl = new ControlClient({ origin: config.portalOrigin, token, fetchImpl, ...access });
        control = dependencies.control ?? configuredControl;
        journal = new FileJournal(join(config.stateDirectory, 'journal'));
        const bootId = randomUUID();
        if (await journal.putIfAbsent('service', { phase: 'boot_unknown', bootId })) fail('SERVICE_RECOVERY_REQUIRED');
        ownsIntent = true;
        const status = await starting(control.request('status', {}));
        if (status?.phase !== 'BOOTING' || status.execution_enabled !== true || !Number.isSafeInteger(status.epoch)) fail('CONTROL_NOT_BOOTABLE');
        const identity = await starting(control.request('boot', { boot_id: bootId }));
        if (identity?.epoch !== status.epoch || identity.boot_id !== bootId) fail('INVALID_BOOT_IDENTITY');
        await journal.update('service', { phase: 'starting', identity });
        activity = new SpritesActivityGuard({ tasks, id: `hehe-${identity.epoch}-${bootId}`, now, onUnsafe: recover });
        await starting(activity.ensure());
        await starting(checkVersion(config.binary));
        const home = join(config.stateDirectory, 'codex-home'), workspace = join(config.stateDirectory, 'workspace');
        await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
        await starting(prepareNative(home));
        if (config.ownerQuestions === true) questions = new CodexQuestionBinding({ journal, control, timeoutMs: 300000,
          resolveBinding: async ({ threadId, turnId }) => {
            // A server question can precede the turn/start reply and Worker ACK.
            // Wait only for that same in-flight admission; never infer its success.
            for (let tries = 0; tries < 400; tries++) {
              if (!['starting', 'running'].includes(phase) || !supervisor) return null;
              supervisor.assertLease();
              const row = await journal.get(supervisor.bridge.cursor);
              if (!row?.attemptId) return null;
              const nativeRow = await journal.get(row.attemptId);
              if (nativeRow?.threadId !== threadId || nativeRow.nativeRunId && nativeRow.nativeRunId !== turnId) return null;
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
        transport = launch({ binary: config.binary, home, cwd: workspace, timeoutMs: 10000,
          ...(questions ? { onUserInput: questions.onUserInput, userInputTimeoutMs: 300000 } : {}) });
        if (questions) {
          questionNotification = message => { void questions.onNotification(message).catch(recover); };
          transport.on('notification', questionNotification);
          transport.on('disconnect', recover);
        }
        // Native diagnostics may contain task data; callers must not log them.
        transport.child.stderr?.resume();
        await starting(transport.initialize());
        adapter = new CodexAdapter({ journal, cwd: workspace, rpc: (method, params) => transport.request(method, params), testMode: true });
        const native = {
          admissionReadiness: () => adapter.admissionReadiness(),
          sleepReadiness: () => adapter.sleepReadiness(),
          cancel: id => adapter.cancel(id),
          submit: async input => {
            supervisor.assertLease();
            const row = await journal.get(supervisor.bridge.cursor);
            if (row?.attemptId !== input.attemptId || !row.claim?.run) fail('CLAIM_IDENTITY_MISMATCH');
            const run = row.claim.run, persona = config.personas[run.persona_id];
            if (!persona) fail('NATIVE_PERSONA_UNMAPPED');
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
            } };
            // Fresh service-owned native home has no inherited global MCP config.
            return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, testMode: true, mcpServers }).submit(input);
          },
        };
        router = new CodexEventRouter({ transport, adapter, onRecovery: recover, now });
        const taskController = async () => {
          const row = await journal.get(supervisor.bridge.cursor);
          if (!row?.attemptId || !row.nativeRunId) return null;
          if (currentAttempt !== row.attemptId) {
            currentAttempt = row.attemptId;
            currentTasks = new CodexTaskControl({ adapter, control, journal, identity, attemptId: row.attemptId,
              parent: { runId: row.claim.run.id, personaId: row.claim.run.persona_id, attempt: row.claim.run.current_attempt },
              assertLease: () => supervisor.assertLease() });
          }
          return currentTasks;
        };
        supervisor = new ExecutionSupervisor({ control, native, journal, identity, installationId: config.installationId,
          personas: config.personas, events: router, activity, operations, now, onRecovery: recover,
          children: { sync: async () => (await taskController())?.sync(), cancel: async ids => (await taskController())?.cancel(ids),
            steer: async () => (await taskController())?.steer(), publishOutputs: async () => (await taskController())?.publishOutputs() } });
        await starting(control.request('ready', { identity }));
        const dispatched = await starting(supervisor.start());
        if (supervisor.phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
        phase = 'running';
        await journal.update('service', { phase });
        return dispatched;
      } catch (error) {
        recover(); await service.stop();
        fail(error.code === 'NATIVE_COMPATIBILITY_GATE_BLOCKED' ? error.code : 'SERVICE_RECOVERY_REQUIRED');
      }
    },
    async observe() {
      await router?.flush();
      const cursor = supervisor && await journal.get(supervisor.bridge.cursor);
      return cursor?.attemptId ? adapter.requireRun(cursor.attemptId) : null;
    },
    async maintain() {
      if (phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
      await router.flush();
      return supervisor.maintain();
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
        if (ownsIntent) await journal.update('service', { phase: 'recovery', nativeStopped: true });
        phase = 'recovery';
        // Intentionally no complete/commit-sleep or activity release on shutdown.
        // Unknown effects and the durable state survive for explicit reconciliation.
      })();
    },
  };
  return service;
}
