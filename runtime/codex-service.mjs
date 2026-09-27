import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AGENT_TOOL_NAMES, readAccessCredentials } from './agent-tools.mjs';
import { BROWSER_POLICY, BROWSER_TOOLS, browserLimits } from './browser-gateway.mjs';
import { ControlClient } from './control-client.mjs';
import { FileJournal } from './file-journal.mjs';
import { CodexAdapter, PINNED_CODEX, RESTRICTED_CODEX_FEATURES, projectOutputMessage } from './codex-adapter.mjs';
import { CodexEventRouter } from './codex-events.mjs';
import { CodexTaskControl } from './codex-tasks.mjs';
import { CodexOperations } from './codex-operations.mjs';
import { spawnCodex } from './codex-transport.mjs';
import { CodexQuestionBinding } from './codex-questions.mjs';
import { ExecutionSupervisor } from './execution-supervisor.mjs';
import { createMemoryCounter, memoryTokenizerMap } from './memory-read.mjs';
import { SpritesActivityGuard } from './sprites-activity-guard.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';
import { stageWarmClaim, warmGenerationBinding } from './owner-alpha-warm-binding.mjs';
import { backgroundProfileSha256, backgroundGenerationBinding, backgroundGenerationPolicy, stageBackgroundClaim, validateBackgroundProfile } from './owner-alpha-background-binding.mjs';
import { codexTextOnlyProfileSha256, createCodexTextOnlyCompletionReceipt,
  createCodexTextOnlyProfile, verifyCodexTextOnlyProfile } from './codex-text-only.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// V4b: coordinator-only task-management tools (ARCHITECTURE_V2 A4). Never
// granted to a coordinator task run's own isolated thread; see the grant
// construction in native.submit below.
const COORDINATOR_ONLY_TASK_TOOLS = Object.freeze(['hehebot_start_task', 'hehebot_list_tasks',
  'hehebot_task_detail', 'hehebot_steer_task', 'hehebot_queue_followup', 'hehebot_cancel_task']);
// V8: v2 execution mode may grant the coordinator task tools under the
// restricted native profile; owner-alpha keeps its narrower read-only set.
const RESTRICTED_TOOLS = Object.freeze(['hehebot_list_routines', 'hehebot_read_skill', 'hehebot_send_message']);
const V2_RESTRICTED_TOOLS = Object.freeze([...RESTRICTED_TOOLS, ...COORDINATOR_ONLY_TASK_TOOLS]);
// Idle grace before the runtime asks to sleep. The Worker's own prepare-sleep
// grace is 60s from its last activity touch; the margin absorbs clock skew so
// a denied prepare-sleep (which fences this executor) stays unlikely.
const V2_IDLE_GRACE_MS = 65000;
const ownerAlphaGeneration = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'boot_id,epoch,transition_id' ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 2 ||
      typeof value.boot_id !== 'string' || !UUID.test(value.boot_id) ||
      typeof value.transition_id !== 'string' || !UUID.test(value.transition_id)) fail('INVALID_SERVICE_CONFIGURATION');
  return Object.freeze({ epoch: value.epoch, boot_id: value.boot_id, transition_id: value.transition_id });
};
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
  // Frozen at composition time: later mutation of the caller's config object
  // never changes a running service's declared shell-operation deadline.
  const shellOperationTimeoutMs = config.shellOperationTimeoutMs;
  const { tasks, fetchImpl, prepareNative = async () => {},
    launch = spawnCodex, now = Date.now, onRecovery = () => {},
    checkVersion = async binary => {
      const result = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
      if (result.stdout.trim() !== `codex-cli ${PINNED_CODEX}`) fail('CODEX_VERSION_MISMATCH');
    } } = dependencies;
  let phase = 'stopped', journal, control, transport, adapter, router, supervisor, activity;
  let taskSupervisor = null, taskAdmission;
  let ownsIntent = false, stopping, questions, questionNotification, admission;
  let alpha = null, textOnlyProfile = null, textOnlyVerification = null, textOnlyCatalogContent = null, commandedConfigContent = null;
  let alphaGeneration = null, alphaWarm = null, alphaBackground = null, backgroundProfile = null;
  let verifyTextOnlyCurrent;
  const hosted = Object.hasOwn(config, 'hostedOwnerBindingSha256');
  // V8: explicit v2-architecture ordinary execution (ARCHITECTURE_V2 A1-A4). It is
  // never an owner-alpha, hosted-alpha or disposable-test composition.
  const v2Mode = config.executionMode === 'v2';
  let v2SleepAllowed = false;
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
        deadlineAt: row.claim.deadline_at, textOnlyProfile: row.claim.text_only ?? null,
        backgroundRole: alphaBackground ? row.claim.role : null, v2Mode,
        ...(shellOperationTimeoutMs !== undefined ? { shellOperationTimeoutMs } : {}) }).snapshot());
    }
    return snapshots;
  });
  // V4c: the background task lane is a plain ordinary-execution supervisor (never
  // alpha/text-only/background-generation), so its own heartbeat snapshot never
  // carries those legacy discriminators. Kept separate from `operations` above
  // rather than parametrized, so the coordinator's alpha-specific snapshot shape
  // is untouched by this change.
  const taskOperations = dependencies.operations ?? (async () => {
    if (!taskSupervisor) return [];
    const snapshots = [];
    for (const row of await taskSupervisor.bridge.families()) {
      if (!row.nativeRunId || row.phase === 'complete') continue;
      snapshots.push(...await new CodexOperations({ journal, attemptId: row.attemptId, runId: row.claim.run.id,
        attempt: row.claim.run.current_attempt, startedAt: row.claim.run.updated_at,
        deadlineAt: row.claim.deadline_at, textOnlyProfile: null, backgroundRole: null, v2Mode,
        ...(shellOperationTimeoutMs !== undefined ? { shellOperationTimeoutMs } : {}) }).snapshot());
    }
    return snapshots;
  });
  const recover = () => {
    if (phase === 'recovery') return;
    phase = 'recovery'; questions?.close(); supervisor?.disconnect(); taskSupervisor?.disconnect();
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
            if (textOnlyProfile && native.nativeOutcome === 'completed' && !native.textOnlyReceipt) {
              const readback = await transport.request('thread/read', { threadId: native.threadId, includeTurns: true });
              const turn = readback?.thread?.turns?.filter(value => value?.id === native.nativeRunId);
              const outputs = turn?.[0]?.items?.filter(item => item?.type === 'agentMessage' &&
                (item.phase === undefined || item.phase === null || item.phase === 'final_answer')) ?? [];
              if (turn?.length !== 1 || outputs.length !== 1) fail('TEXT_ONLY_OUTPUT_AMBIGUOUS');
              const verification = await verifyTextOnlyCurrent();
              await router.flush();
              supervisor.assertLease();
              const observed = await adapter.requireRun(row.attemptId);
              const messages = turn[0].items.filter(item => item.type === 'agentMessage');
              if (messages.length !== Object.keys(observed.outputItems ?? {}).length || messages.some(item =>
                  observed.outputItems?.[item.id] !== projectOutputMessage(item).outputDigest)) fail('TEXT_ONLY_OUTPUT_AMBIGUOUS');
              const full = createCodexTextOnlyCompletionReceipt({ profile: textOnlyProfile, verification,
                expected: { threadId: native.threadId, turnId: native.nativeRunId, agentItemId: outputs[0].id, outputText: outputs[0].text },
                submission: native.textOnlySubmission, readback: { method: 'thread/read',
                  params: { threadId: native.threadId, includeTurns: true }, result: readback },
                eventRouter: { threadId: native.threadId, turnId: native.nativeRunId,
                  healthy: phase === 'running' && router.closed === false,
                  fullyFlushed: router.pending.length === 0, streamLossObserved: phase !== 'running' || router.closed === true } });
              const { result, ...receipt } = full;
              await journal.update(row.attemptId, { textOnlyReceipt: receipt });
              const snapshot = await operations();
              if (snapshot.some(operation => operation.run_id === row.claim.run.id && operation.status !== 'settled')) fail('NATIVE_SETTLEMENT_INCOMPLETE');
              const cancellations = await supervisor.heartbeat();
              if (cancellations.includes(row.claim.run.id)) fail('OWNER_ALPHA_ADMISSION_DENIED');
              supervisor.assertLease();
              await supervisor.bridge.complete({ attemptId: row.attemptId, nativeRunId: native.nativeRunId,
                rootSettled: true, toolsSettled: true, childrenSettled: true, effectsSettled: true,
                outputCommitted: true, result, text_only_receipt: receipt });
            }
            // Background roles status/independent settle canonically with a
            // root-only background receipt after the coordinator release is
            // durably observed. The role background root never completes here:
            // its release keeps uncertainty and family settlement rejected.
            if (alphaBackground && row.claim.role !== 'background' &&
                native.nativeOutcome === 'completed' && !native.backgroundReceipt) {
              const readback = await transport.request('thread/read', { threadId: native.threadId, includeTurns: true });
              const turn = readback?.thread?.turns?.filter(value => value?.id === native.nativeRunId);
              const outputs = turn?.[0]?.items?.filter(item => item?.type === 'agentMessage' &&
                (item.phase === undefined || item.phase === null || item.phase === 'final_answer')) ?? [];
              if (turn?.length !== 1 || outputs.length !== 1) fail('BACKGROUND_OUTPUT_AMBIGUOUS');
              await router.flush();
              supervisor.assertLease();
              const observed = await adapter.requireRun(row.attemptId);
              const messages = turn[0].items.filter(item => item.type === 'agentMessage');
              if (messages.length !== Object.keys(observed.outputItems ?? {}).length || messages.some(item =>
                  observed.outputItems?.[item.id] !== projectOutputMessage(item).outputDigest)) fail('BACKGROUND_OUTPUT_AMBIGUOUS');
              const backgroundReceipt = { thread_id: native.threadId, turn_id: native.nativeRunId,
                output_sha256: createHash('sha256').update(outputs[0].text).digest('hex') };
              await journal.update(row.attemptId, { backgroundReceipt });
              const snapshot = await operations();
              if (snapshot.some(operation => operation.run_id === row.claim.run.id && operation.status !== 'settled')) fail('NATIVE_SETTLEMENT_INCOMPLETE');
              const cancellations = await supervisor.heartbeat();
              if (cancellations.includes(row.claim.run.id)) fail('OWNER_ALPHA_ADMISSION_DENIED');
              supervisor.assertLease();
              await supervisor.bridge.complete({ attemptId: row.attemptId, nativeRunId: native.nativeRunId,
                rootSettled: true, toolsSettled: true, childrenSettled: true, effectsSettled: true,
                outputCommitted: true, result: { status: 'completed', text: outputs[0].text },
                background_receipt: backgroundReceipt });
            }
          }
        }
      });
      return supervisor.dispatch();
    })().catch(error => { recover(); throw error; }).finally(() => { admission = null; });
    return admission;
  };
  // V4c: the background task lane has no coordinator-release/text-only/background-
  // receipt admission ceremony -- only one task is ever active at a time and its
  // own settlement is driven externally via `taskSupervisor.complete()`, exactly
  // like the coordinator's own `complete()` is. Admission here is just re-dispatch.
  const admitTask = () => {
    if (!taskSupervisor) return Promise.resolve(null);
    if (taskAdmission) return taskAdmission;
    taskAdmission = (async () => {
      await router.flush();
      return taskSupervisor.dispatch();
    })().catch(error => { recover(); throw error; }).finally(() => { taskAdmission = null; });
    return taskAdmission;
  };
  // V8 (ARCHITECTURE_V2 A1/A3): the trusted settlement driver for v2 mode. A
  // root turn that is terminal, has no native descendants and whose projected
  // operations are all settled completes its attempt with the turn's final
  // assistant text. Completion never gates a committed hehebot_send_message
  // (A1); it only closes the attempt so the lane, the task.event wake and
  // sleep can proceed. The Worker re-checks operations, locks, questions and
  // effects and stays authoritative; a refusal leaves the run live and visible
  // and is retried on the next maintenance tick, never replayed natively.
  const v2Result = async (row, native, cancelled) => {
    if (row.result) return row.result;
    if (cancelled) return { status: 'cancelled', text: '' };
    if (native.nativeOutcome !== 'completed') return native.nativeOutcome === 'interrupted'
      ? { status: 'cancelled', text: '', error_code: 'NATIVE_INTERRUPTED' }
      : { status: 'failed', text: '', error_code: 'NATIVE_TURN_FAILED' };
    const readback = await transport.request('thread/read', { threadId: native.threadId, includeTurns: true });
    const turn = readback?.thread?.turns?.find(value => value?.id === native.nativeRunId);
    const finals = (turn?.items ?? []).filter(item => item?.type === 'agentMessage' && typeof item.text === 'string' &&
      (item.phase === undefined || item.phase === null || item.phase === 'final_answer'));
    return { status: 'completed', text: (finals.at(-1)?.text ?? '').slice(0, 32000) };
  };
  const settleV2 = async sup => {
    if (!v2Mode || !sup || sup.phase !== 'running') return;
    for (const row of await sup.bridge.families()) {
      if (!row.nativeRunId || !row.claim?.run || !['running', 'complete_pending'].includes(row.phase)) continue;
      try {
        const native = await adapter.requireRun(row.attemptId);
        if (native.rootSettled !== true || Object.keys(native.childTurns ?? {}).length ||
            Object.keys(native.childObligations ?? {}).length) continue;
        const snapshot = await new CodexOperations({ journal, attemptId: row.attemptId, runId: row.claim.run.id,
          attempt: row.claim.run.current_attempt, startedAt: row.claim.run.updated_at, deadlineAt: row.claim.deadline_at,
          v2Mode, ...(shellOperationTimeoutMs !== undefined ? { shellOperationTimeoutMs } : {}) }).snapshot();
        if (snapshot.some(operation => operation.status !== 'settled')) continue;
        // Publish the settled projection before asking the Worker to complete.
        const cancellations = await sup.heartbeat();
        const result = await v2Result(row, native, cancellations.includes(row.claim.run.id));
        await sup.complete({ attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: true,
          toolsSettled: true, childrenSettled: true, effectsSettled: true, outputCommitted: true, result });
      } catch (error) {
        if (error?.code === 'EXECUTOR_FENCED') throw error;
        // Worker refusal or transport uncertainty: the run stays live and visible.
      }
    }
  };
  const service = {
    get phase() { return phase; },
    get supervisor() { return supervisor; },
    get taskSupervisor() { return taskSupervisor; },
    get adapter() { return adapter; },
    get journal() { return journal; },
    async start() {
      if (phase !== 'stopped') fail('SERVICE_ALREADY_STARTED');
      let bootIdentity = null;
      // Hosted composition requires a pinned owner and real activity custody.
      // Control admission needs its separate explicit hosted policy and marker.
      if (hosted && (typeof config.hostedOwnerBindingSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(config.hostedOwnerBindingSha256) || config.ownerAlpha === undefined ||
          typeof config.accessClientIdFile !== 'string' || typeof config.accessClientSecretFile !== 'string' ||
          typeof tasks?.hold !== 'function' || typeof tasks?.release !== 'function')) fail('INVALID_SERVICE_CONFIGURATION');
      // Supervised alpha is explicit and separate from test/production gates.
      if (config.ownerAlpha !== undefined) {
        alpha = ownerAlphaPolicy(config.ownerAlpha);
        if (config.textOnlyProfile !== undefined) {
          if (!alpha.text_only) fail('INVALID_SERVICE_CONFIGURATION');
          textOnlyProfile = createCodexTextOnlyProfile(config.textOnlyProfile);
          if (codexTextOnlyProfileSha256(textOnlyProfile) !== alpha.text_only.profile_sha256) fail('TEXT_ONLY_PROFILE_MISMATCH');
          if (Object.values(config.personas ?? {}).some(persona => persona.model !== textOnlyProfile.model || persona.allowedTools?.length)) fail('INVALID_SERVICE_CONFIGURATION');
        } else if (alpha.text_only) fail('INVALID_SERVICE_CONFIGURATION');
        const remaining = Date.parse(alpha.expires_at) - now();
        let origin; try { origin = new URL(config.portalOrigin); } catch { fail('INVALID_SERVICE_CONFIGURATION'); }
        if (config.disposableTest === true || remaining <= 0 || remaining > 300000 ||
            !hosted && !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) ||
            Object.keys(config.personas ?? {}).length !== 1 || !config.personas?.[alpha.persona_id] ||
            config.ownerQuestions === true || config.restrictedPermissions === false) fail('INVALID_SERVICE_CONFIGURATION');
        config.restrictedPermissions = true;
      } else if (v2Mode) {
        // A loopback-only local control plane has no owner binding (AUTH_MODE
        // local); any other origin must pin the Access owner binding.
        let v2Origin; try { v2Origin = new URL(config.portalOrigin); } catch { fail('INVALID_SERVICE_CONFIGURATION'); }
        const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(v2Origin.hostname);
        if (config.disposableTest !== undefined || hosted || config.backgroundTaskLane === false ||
            !(typeof config.ownerBindingSha256 === 'string' && /^[a-f0-9]{64}$/.test(config.ownerBindingSha256) ||
              config.ownerBindingSha256 === null && loopback) ||
            config.ownerQuestions === true) fail('INVALID_SERVICE_CONFIGURATION');
      } else if (config.disposableTest !== true) fail('NATIVE_COMPATIBILITY_GATE_BLOCKED');
      if (config.executionMode !== undefined && !v2Mode || config.ownerBindingSha256 !== undefined && !v2Mode) fail('INVALID_SERVICE_CONFIGURATION');
      if (config.ownerAlphaGeneration !== undefined) {
        alphaGeneration = ownerAlphaGeneration(config.ownerAlphaGeneration);
        if (!hosted || !alpha || (alpha.text_only ? !textOnlyProfile : alpha.background_first_root !== true)) fail('INVALID_SERVICE_CONFIGURATION');
      }
      // The warm binding is a separate explicit kind: it requires the hosted
      // text-only generation composition and never widens the legacy contract.
      if (config.ownerAlphaWarm !== undefined) {
        alphaWarm = warmGenerationBinding(config.ownerAlphaWarm);
        if (!hosted || !alphaGeneration || !alpha?.text_only || !textOnlyProfile ||
            alpha.background_first_root === true) fail('INVALID_SERVICE_CONFIGURATION');
      }
      // The background binding is a separate explicit kind: it requires the
      // hosted background generation composition (background_first_root, never
      // text_only) and never widens the legacy, warm or text-only contracts.
      if (config.ownerAlphaBackground !== undefined) {
        alphaBackground = backgroundGenerationBinding(config.ownerAlphaBackground);
        backgroundProfile = validateBackgroundProfile(config.backgroundProfile);
        if (!hosted || !alphaGeneration || alpha?.background_first_root !== true || alphaWarm ||
            alpha?.text_only || textOnlyProfile ||
            backgroundProfileSha256(backgroundProfile) !== alphaBackground.background_profile_sha256) fail('INVALID_SERVICE_CONFIGURATION');
      } else if (config.backgroundProfile !== undefined) fail('INVALID_SERVICE_CONFIGURATION');
      if (config.textOnlyProfile !== undefined && !alpha?.text_only) fail('INVALID_SERVICE_CONFIGURATION');
      if (Object.keys(config).some(key => !['disposableTest', 'stateDirectory', 'binary', 'portalOrigin',
        'runtimeTokenFile', 'tlsCAFile', 'installationId', 'personas', 'accessClientIdFile', 'accessClientSecretFile', 'ownerQuestions', 'restrictedPermissions', 'ownerAlpha', 'ownerAlphaGeneration', 'ownerAlphaWarm', 'ownerAlphaBackground', 'backgroundProfile', 'nativeHome', 'hostedOwnerBindingSha256', 'textOnlyProfile', 'shellOperationTimeoutMs', 'backgroundTaskLane', 'executionMode', 'ownerBindingSha256', 'memoryTokenizers', 'browser'].includes(key)) ||
        config.nativeHome !== undefined && (!alpha && !v2Mode || typeof config.nativeHome !== 'string' || !isAbsolute(config.nativeHome)) ||
        config.browser !== undefined && (!v2Mode || !config.browser || typeof config.browser !== 'object' ||
          Object.keys(config.browser).some(key => !['dir', 'limits'].includes(key)) || typeof config.browser.dir !== 'string' || !isAbsolute(config.browser.dir) ||
          (() => { try { browserLimits(config.browser.limits ?? {}); return false; } catch { return true; } })()) ||
        config.ownerQuestions !== undefined && typeof config.ownerQuestions !== 'boolean' ||
        config.restrictedPermissions !== undefined && typeof config.restrictedPermissions !== 'boolean' ||
        config.memoryTokenizers !== undefined && (() => { try { memoryTokenizerMap(config.memoryTokenizers); return false; } catch { return true; } })() ||
        // The background task lane is a plain ordinary-execution concern: it is
        // never offered on an owner-alpha/hosted staged boot (single-lane always).
        config.backgroundTaskLane !== undefined && (typeof config.backgroundTaskLane !== 'boolean' || alpha) ||
        // A declared shell-operation deadline is a timing bound only: it never
        // widens the admitted tool surface, and it must be an explicit safe
        // integer above the two-minute default, capped at ten minutes.
        config.shellOperationTimeoutMs !== undefined && (typeof config.shellOperationTimeoutMs !== 'number' ||
          !Number.isSafeInteger(config.shellOperationTimeoutMs) || config.shellOperationTimeoutMs < 120001 || config.shellOperationTimeoutMs > 600000)) fail('INVALID_SERVICE_CONFIGURATION');
      if (!alpha && (!tasks?.hold || !tasks?.release) || typeof operations !== 'function' ||
          !isAbsolute(config.binary) || !config.personas || !isAbsolute(config.stateDirectory)) fail('INVALID_SERVICE_CONFIGURATION');
      for (const persona of Object.values(config.personas)) {
        if (!Array.isArray(persona.allowedTools) || new Set(persona.allowedTools).size !== persona.allowedTools.length ||
            persona.allowedTools.some(tool => !AGENT_TOOL_NAMES.includes(tool))) fail('INVALID_SERVICE_CONFIGURATION');
        if (persona.allowedTools.includes('hehebot_search_skills') &&
            (alpha || !persona.allowedTools.includes('hehebot_propose_skill'))) fail('INVALID_SERVICE_CONFIGURATION');
        if (alpha && persona.allowedTools.includes('hehebot_read_memory')) fail('INVALID_SERVICE_CONFIGURATION');
        if (config.restrictedPermissions && persona.allowedTools.some(tool => !(v2Mode ? V2_RESTRICTED_TOOLS : RESTRICTED_TOOLS).includes(tool))) fail('INVALID_SERVICE_CONFIGURATION');
        // v2 task runs carry no memory budget (only the coordinator lane
        // prepares memory), so the memory tool is not offered in this mode.
        if (v2Mode && persona.allowedTools.includes('hehebot_read_memory')) fail('INVALID_SERVICE_CONFIGURATION');
      }
      phase = 'starting';
      try {
        if (textOnlyProfile) {
          await privatePath(textOnlyProfile.startupConfig.model_catalog_json);
          textOnlyCatalogContent = await readFile(textOnlyProfile.startupConfig.model_catalog_json);
          commandedConfigContent = Buffer.from(JSON.stringify(textOnlyProfile.startupConfig));
          if (!textOnlyCatalogContent.equals(Buffer.from(JSON.stringify(textOnlyProfile.modelCatalog)))) fail('TEXT_ONLY_PROFILE_CHANGED');
        }
        await starting(() => privatePath(config.stateDirectory, true));
        await starting(() => privatePath(config.runtimeTokenFile));
        const token = (await starting(() => readFile(config.runtimeTokenFile, 'utf8'))).trim();
        const access = await starting(() => readAccessCredentials(config));
        const configuredControl = new ControlClient({ origin: config.portalOrigin, token, fetchImpl,
          ...(alphaWarm ? { principal: 'warm-host' } : alphaBackground ? { principal: 'background-host' } : {}), ...access });
        control = dependencies.control ?? configuredControl;
        journal = new FileJournal(join(config.stateDirectory, 'journal'));
        const bootId = alphaGeneration?.boot_id ?? randomUUID();
        assertStarting();
        if (await journal.putIfAbsent('service', { phase: 'boot_unknown', bootId, ...(alpha ? { ownerAlpha: alpha } : {}),
          ...(alphaGeneration ? { ownerAlphaGeneration: alphaGeneration } : {}),
          ...(alphaWarm ? { ownerAlphaWarm: alphaWarm } : {}),
          ...(alphaBackground ? { ownerAlphaBackground: alphaBackground } : {}),
          ...(hosted ? { hostedOwner: { bindingSha256: config.hostedOwnerBindingSha256,
            origin: new URL(config.portalOrigin).origin } } : {}) })) fail('SERVICE_RECOVERY_REQUIRED');
        ownsIntent = true;
        assertStarting();
        const status = await starting(() => control.request('status', {}));
        if (hosted && status?.owner_binding_sha256 !== config.hostedOwnerBindingSha256) fail('OWNER_BINDING_MISMATCH');
        if (hosted ? status?.owner_alpha_hosted !== true : Object.hasOwn(status ?? {}, 'owner_alpha_hosted')) fail('CONTROL_NOT_BOOTABLE');
        if (alphaWarm) {
          // A warm generation identifies itself only through the versioned warm
          // discriminator; the legacy owner_alpha_generation summary must stay
          // absent so no legacy credential can adopt this boot.
          if (status?.phase !== 'BOOTING' || status.epoch !== alphaGeneration.epoch || status.execution_enabled !== false ||
              JSON.stringify(ownerAlphaPolicy(status.owner_alpha)) !== JSON.stringify(alpha) ||
              JSON.stringify(ownerAlphaGeneration(status.owner_alpha_warm_generation)) !== JSON.stringify(alphaGeneration) ||
              Object.hasOwn(status ?? {}, 'owner_alpha_generation')) fail('CONTROL_NOT_BOOTABLE');
        } else if (alphaBackground) {
          // A background generation identifies itself only through the versioned
          // background discriminator; legacy and warm summaries must stay absent
          // so no legacy or warm credential can adopt this boot. The Durable
          // Object reports the generation policy (full restricted profile under
          // `background`), not the staged runtime shape, so the comparison goes
          // through the versioned background policy validator, never the generic
          // warm/legacy ownerAlphaPolicy shape.
          const expectedGenerationPolicy = { session_id: alpha.session_id, persona_id: alpha.persona_id,
            expires_at: alpha.expires_at, max_runs: alpha.max_runs, max_task_seconds: alpha.max_task_seconds,
            background: structuredClone(backgroundProfile) };
          if (status?.phase !== 'BOOTING' || status.epoch !== alphaGeneration.epoch || status.execution_enabled !== false ||
              JSON.stringify(backgroundGenerationPolicy(status.owner_alpha, { alpha, backgroundProfile })) !==
                JSON.stringify(expectedGenerationPolicy) ||
              JSON.stringify(ownerAlphaGeneration(status.owner_alpha_background_generation)) !== JSON.stringify(alphaGeneration) ||
              Object.hasOwn(status ?? {}, 'owner_alpha_generation') || Object.hasOwn(status ?? {}, 'owner_alpha_warm_generation')) fail('CONTROL_NOT_BOOTABLE');
        } else if (alphaGeneration) {
          if (status?.phase !== 'BOOTING' || status.epoch !== alphaGeneration.epoch || status.execution_enabled !== false ||
              JSON.stringify(ownerAlphaPolicy(status.owner_alpha)) !== JSON.stringify(alpha) ||
              JSON.stringify(ownerAlphaGeneration(status.owner_alpha_generation)) !== JSON.stringify(alphaGeneration)) fail('CONTROL_NOT_BOOTABLE');
        } else if (Object.hasOwn(status ?? {}, 'owner_alpha_generation')) fail('CONTROL_NOT_BOOTABLE');
        else if (v2Mode) {
          // The control plane must itself be in v2 mode for this exact owner.
          if (status?.phase !== 'BOOTING' || status.execution_enabled !== true || status.execution_mode !== 'v2' ||
              !Number.isSafeInteger(status.epoch) || (status.owner_binding_sha256 ?? null) !== config.ownerBindingSha256 ||
              Object.hasOwn(status, 'owner_alpha')) fail('CONTROL_NOT_BOOTABLE');
        } else if (alpha) {
          if (status?.phase !== 'STOPPED' || status.epoch !== 0 || status.execution_enabled !== false ||
              JSON.stringify(ownerAlphaPolicy(status.owner_alpha)) !== JSON.stringify(alpha)) fail('CONTROL_NOT_BOOTABLE');
        } else if (status?.phase !== 'BOOTING' || status.execution_enabled !== true || !Number.isSafeInteger(status.epoch)) fail('CONTROL_NOT_BOOTABLE');
        const identity = await starting(() => control.request('boot', { boot_id: bootId }));
        if (identity?.epoch !== (alphaGeneration?.epoch ?? (alpha ? 1 : status.epoch)) || identity.boot_id !== bootId) fail('INVALID_BOOT_IDENTITY');
        bootIdentity = identity;
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
        const configOverrides = { ...(config.restrictedPermissions ? {
          web_search: 'disabled',
          ...Object.fromEntries(Object.entries(RESTRICTED_CODEX_FEATURES).map(([key, value]) => [`features.${key}`, value])),
          ...(alpha || v2Mode ? { 'agents.enabled': false, 'features.multi_agent': false, 'features.multi_agent_v2': false } : {}),
        } : {}), ...(textOnlyProfile?.startupConfig ?? {}) };
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
              .filter(Boolean).map(path => [path, 'deny'])),
            // Warm and background task tokens live beside the journal: model-visible
            // paths stay denied so the native sandbox can never read staged credentials.
            ...((alphaWarm || alphaBackground) ? { [join(config.stateDirectory, 'task-tokens')]: 'deny' } : {}) };
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
            if (key === 'mcp_servers' || ['tools.experimental_request_user_input.enabled', 'tools.update_plan.enabled'].includes(key)) return false;
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
          if (textOnlyProfile) {
            textOnlyVerification = { codexVersion: PINNED_CODEX, model: textOnlyProfile.model, configReadback: readback.config };
            verifyCodexTextOnlyProfile(textOnlyProfile, { ...textOnlyVerification,
              catalogContent: textOnlyCatalogContent, commandedConfigContent });
            verifyTextOnlyCurrent = async () => {
              const contents = await readFile(join(home, 'config.toml')).catch(error => {
                if (config.nativeHome && error.code === 'ENOENT') return '';
                throw error;
              });
              if (createHash('sha256').update(contents).digest('hex') !== permissions.configSha256) fail('RESTRICTED_PROFILE_CHANGED');
              const current = await transport.request('config/read', { includeLayers: false, cwd: workspace });
              const verification = { codexVersion: PINNED_CODEX, model: textOnlyProfile.model, configReadback: current.config,
                catalogContent: await readFile(textOnlyProfile.startupConfig.model_catalog_json), commandedConfigContent };
              verifyCodexTextOnlyProfile(textOnlyProfile, verification);
              return verification;
            };
          }
        }
        assertStarting();
        adapter = new CodexAdapter({ journal, cwd: workspace, rpc: (method, params) => {
          // Durable intent writes may outlive the controller's prior lease check.
          // This rpc closure is shared by both lanes' CodexAdapter instances (one
          // native connection, one fenced identity/epoch); a durable-intent write
          // fences on every lane currently in play, never on the coordinator alone.
          if (method === 'turn/steer' || method === 'turn/interrupt') { supervisor.assertLease(); taskSupervisor?.assertLease(); }
          return transport.request(method, params);
        },
          testMode: !alpha, ownerAlpha: alpha, now, permissionsProfile: permissions?.name, textOnlyProfile });
        const native = {
          admissionReadiness: () => adapter.admissionReadiness(),
          // V8 (ARCHITECTURE_V2 A3): in v2 mode sleep readiness is the service's
          // own both-lanes-idle observation (see service.sleep); the Worker's
          // prepare/commit-sleep predicate stays authoritative.
          sleepReadiness: () => v2Mode ? { allowed: v2SleepAllowed, blockers: v2SleepAllowed ? [] : ['V2_LANES_NOT_IDLE'] } : adapter.sleepReadiness(),
          cancel: id => adapter.cancel(id),
          submit: async input => {
            input = { ...input };
            // V4c: the background task lane shares this single native.submit
            // closure with the coordinator lane (same Codex app-server connection,
            // same fenced identity/epoch). `lane` is routing metadata added by
            // ExecutionBridge; it must never reach the strict-validated
            // CodexAdapter.submit() input allowlist below, so it is stripped here.
            const lane = input.lane === 'background' ? 'background' : 'coordinator';
            delete input.lane;
            if (lane === 'background' && !taskSupervisor) fail('INVALID_SUBMISSION');
            const sup = lane === 'background' ? taskSupervisor : supervisor;
            const background = Object.hasOwn(input, 'ownerAlphaBackground');
            if (background && (input.ownerAlphaBackground !== true || alpha?.background_first_root !== true)) fail('OWNER_ALPHA_ADMISSION_DENIED');
            sup.assertLease();
            if (permissions) {
              const contents = await readFile(join(home, 'config.toml')).catch(error => {
                if (config.nativeHome && error.code === 'ENOENT') return '';
                throw error;
              });
              if (createHash('sha256').update(contents).digest('hex') !== permissions.configSha256) fail('RESTRICTED_PROFILE_CHANGED');
              sup.assertLease();
            }
            const row = await journal.get(sup.bridge.cursor);
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
            if (textOnlyProfile) {
              if (JSON.stringify(row.claim.text_only) !== JSON.stringify(alpha.text_only)) fail('TEXT_ONLY_PROFILE_MISMATCH');
              await verifyTextOnlyCurrent();
              supervisor.assertLease();
              return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, ownerAlpha: { ...alpha, expires_at: row.claim.deadline_at },
                now, permissionsProfile: permissions?.name, textOnlyProfile }).submit(input);
            }
            if (alphaBackground) {
              // Only staged background-family claims reach a background
              // generation. Each claim carries its own write-once staged task
              // token; the host runtime credential never enters a child grant.
              if (row.claim.role === undefined || typeof row.claim.task_credential?.token_file !== 'string' ||
                  !isAbsolute(row.claim.task_credential.token_file) ||
                  row.claim.task_credential.grant?.run_id !== run.id) fail('OWNER_ALPHA_ADMISSION_DENIED');
              if (row.claim.role === 'background' !== background) fail('OWNER_ALPHA_ADMISSION_DENIED');
              const grant = { origin: config.portalOrigin, tokenFile: row.claim.task_credential.token_file,
                ...(config.accessClientIdFile ? { accessClientIdFile: config.accessClientIdFile, accessClientSecretFile: config.accessClientSecretFile } : {}),
                identity, runId: run.id, attempt: run.current_attempt, allowedTools: persona.allowedTools, principal: 'background-task' };
              // Write once, fsync, never rewrite an admitted grant in place.
              const key = `grant-${input.attemptId}`;
              const existing = await journal.putIfAbsent(key, grant);
              if (existing && JSON.stringify(existing) !== JSON.stringify(grant)) fail('TASK_GRANT_CONFLICT');
              supervisor.assertLease();
              // The status root carries no MCP surface at all: its frozen
              // summary composes into the restricted prompt, nothing else.
              if (row.claim.role === 'status') {
                return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, testMode: !alpha,
                  ownerAlpha: { ...alpha, expires_at: row.claim.deadline_at }, now,
                  permissionsProfile: permissions?.name }).submit(input);
              }
              const mcpServers = { hehebot: {
                command: process.execPath, args: [fileURLToPath(new URL('./agent-tools.mjs', import.meta.url))],
                env: { HEHEBOT_AGENT_TOOLS_CONFIG: journal.path(key),
                  ...(config.tlsCAFile ? { NODE_EXTRA_CA_CERTS: config.tlsCAFile } : {}) },
                tools: Object.fromEntries(persona.allowedTools.map(name => [name, { approval_mode: 'approve' }])),
                ...(permissions ? { enabled_tools: persona.allowedTools } : {}),
              } };
              return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, testMode: !alpha,
                ownerAlpha: { ...alpha, expires_at: row.claim.deadline_at }, now, mcpServers,
                permissionsProfile: permissions?.name }).submit(input);
            }
            // V4b (ARCHITECTURE_V2 A4): a coordinator task run (marked coordinator_task
            // by task.start) never carries the coordinator-only task-management
            // tools into its own isolated thread -- hehebot_send_message (and any
            // other ordinarily-granted tool) is still available, but the task
            // cannot itself start, list, steer or cancel tasks. This is
            // defense-in-depth: ControlCore already refuses task.start from a
            // background run (see tests/task-tools.test.ts "no recursive fan-out").
            const taskContext = JSON.parse(run.context_json);
            const allowedTools = taskContext.coordinator_task === true
              ? persona.allowedTools.filter(name => !COORDINATOR_ONLY_TASK_TOOLS.includes(name))
              : persona.allowedTools;
            const grant = { origin: config.portalOrigin, tokenFile: config.runtimeTokenFile,
              ...(config.accessClientIdFile ? { accessClientIdFile: config.accessClientIdFile, accessClientSecretFile: config.accessClientSecretFile } : {}),
              identity, runId: run.id, attempt: run.current_attempt, allowedTools };
            if (allowedTools.includes('hehebot_read_memory')) {
              const budget = taskContext.memory_budget;
              if (!budget || budget.selected_model !== input.model || budget.run_id !== run.id || budget.attempt !== run.current_attempt) fail('TASK_GRANT_CONFLICT');
              grant.memoryBudget = { selected_model: budget.selected_model, sha256: budget.sha256 };
            }
            // Write once, fsync, never rewrite an admitted grant in place.
            const key = `grant-${input.attemptId}`;
            const existing = await journal.putIfAbsent(key, grant);
            if (existing && JSON.stringify(existing) !== JSON.stringify(grant)) fail('TASK_GRANT_CONFLICT');
            sup.assertLease();
            const mcpServers = { hehebot: {
              command: process.execPath, args: [fileURLToPath(new URL('./agent-tools.mjs', import.meta.url))],
              env: { HEHEBOT_AGENT_TOOLS_CONFIG: journal.path(key),
                ...(config.tlsCAFile ? { NODE_EXTRA_CA_CERTS: config.tlsCAFile } : {}) },
              tools: Object.fromEntries(allowedTools.map(name => [name, { approval_mode: 'approve' }])),
              ...(permissions ? { enabled_tools: allowedTools } : {}),
            } };
            // Browser use only through the hehebot-browser gateway, and only when
            // the Worker-side grant (persona tool policy, or the task's admitted
            // capabilities) includes it. Approval is the gateway's fence.
            if (config.browser && (taskContext.persona?.body?.tool_policy_ids ?? []).includes(BROWSER_POLICY)) {
              const browserKey = `browser-${input.attemptId}`;
              const browserGrant = { origin: grant.origin, tokenFile: grant.tokenFile,
                ...(grant.accessClientIdFile ? { accessClientIdFile: grant.accessClientIdFile, accessClientSecretFile: grant.accessClientSecretFile } : {}),
                identity, runId: run.id, attempt: run.current_attempt, browserDir: config.browser.dir,
                outputDir: join(config.stateDirectory, 'browser', input.attemptId), ...(config.browser.limits ? { limits: config.browser.limits } : {}) };
              const existingBrowser = await journal.putIfAbsent(browserKey, browserGrant);
              if (existingBrowser && JSON.stringify(existingBrowser) !== JSON.stringify(browserGrant)) fail('TASK_GRANT_CONFLICT');
              mcpServers.hehebot_browser = {
                command: process.execPath, args: [fileURLToPath(new URL('./browser-gateway.mjs', import.meta.url))],
                env: { HEHEBOT_BROWSER_GATEWAY_CONFIG: journal.path(browserKey), ...(config.tlsCAFile ? { NODE_EXTRA_CA_CERTS: config.tlsCAFile } : {}) },
                tools: Object.fromEntries(BROWSER_TOOLS.map(name => [name, { approval_mode: 'approve' }])),
                ...(permissions ? { enabled_tools: [...BROWSER_TOOLS] } : {}),
              };
            }
            // Fresh service-owned native home has no inherited global MCP config.
            return new CodexAdapter({ journal, cwd: workspace, rpc: adapter.rpc, testMode: !alpha,
              ownerAlpha: alpha ? { ...alpha, expires_at: row.claim.deadline_at } : null, now, mcpServers,
              permissionsProfile: permissions?.name }).submit(input);
          },
        };
        router = new CodexEventRouter({ transport, adapter, onRecovery: recover, now });
        // V4c: notifications/children are keyed by `attemptId`, already globally
        // unique per lane (it hashes the claim's submission_key, which embeds the
        // run id), so one shared map safely covers both lanes' native families.
        // Each row's own supervisor -- never the other lane's -- owns its fence.
        const eachController = async action => {
          for (const sup of [supervisor, taskSupervisor].filter(Boolean)) {
            for (const row of await sup.bridge.families()) {
              if (!row.nativeRunId || row.phase === 'complete') continue;
              if (!taskControllers.has(row.attemptId)) {
                taskControllers.set(row.attemptId, new CodexTaskControl({ adapter, control, journal, identity, attemptId: row.attemptId,
                  parent: { runId: row.claim.run.id, personaId: row.claim.run.persona_id, attempt: row.claim.run.current_attempt },
                  assertLease: () => sup.assertLease() }));
              }
              await action(taskControllers.get(row.attemptId));
            }
          }
        };
        const memoryCounter = createMemoryCounter(memoryTokenizerMap(config.memoryTokenizers ?? {}));
        supervisor = new ExecutionSupervisor({ control, native, journal, identity, installationId: config.installationId,
          personas: config.personas, events: router, activity, operations, now, onRecovery: recover,
          admission: admit,
          ...(!alpha ? { memoryCounter } : {}),
          ...(alphaWarm ? { claimStage: claim => stageWarmClaim(claim, {
            installationId: config.installationId, stateDirectory: config.stateDirectory,
            generation: { epoch: alphaGeneration.epoch, boot_id: alphaGeneration.boot_id,
              transition_id: alphaGeneration.transition_id, session_id: alpha.session_id, persona_id: alpha.persona_id },
            generationSha256: alphaWarm.generation_sha256, textOnly: alpha.text_only, now }) } : {}),
          ...(alphaBackground ? { claimStage: claim => stageBackgroundClaim(claim, {
            installationId: config.installationId, stateDirectory: config.stateDirectory,
            generation: { epoch: alphaGeneration.epoch, boot_id: alphaGeneration.boot_id,
              transition_id: alphaGeneration.transition_id, session_id: alpha.session_id, persona_id: alpha.persona_id },
            generationSha256: alphaBackground.generation_sha256, background: backgroundProfile, now }) } : {}),
          children: { sync: () => eachController(controller => controller.sync()), cancel: ids => eachController(controller => controller.cancel(ids)),
            steer: () => eachController(controller => controller.steer()), publishOutputs: () => eachController(controller => controller.publishOutputs()) } });
        // V4c: the background task lane is a second ExecutionSupervisor sharing this
        // same native connection/adapter/router and single fenced boot identity --
        // both lanes are the same generation, so epoch fencing applies to both.
        // It is never constructed for owner-alpha/hosted/warm/background-generation
        // composition (always single-lane there); ordinary local execution gets it
        // unless the caller explicitly opts out via `backgroundTaskLane: false`.
        const taskLaneEnabled = !alpha && config.backgroundTaskLane !== false;
        if (taskLaneEnabled) {
          taskSupervisor = new ExecutionSupervisor({ control, native, journal, identity, installationId: config.installationId,
            personas: config.personas, events: router, activity, operations: taskOperations, now, onRecovery: recover,
            // No memoryCounter: memory-prepare only ever prepares the coordinator
            // lane's next run, so a counted task-lane claim either stalls (no
            // coordinator queued) or is refused by claim(). Task runs carry no
            // memory budget by design (their context is the task.start snapshot).
            admission: admitTask, lane: 'background' });
        }
        await starting(() => control.request('ready', { identity }));
        const dispatched = await starting(() => supervisor.start());
        if (supervisor.phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
        if (taskSupervisor) {
          await starting(() => taskSupervisor.start());
          if (taskSupervisor.phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
        }
        await starting(() => journal.update('service', { phase: 'running' }));
        assertStarting();
        phase = 'running';
        return dispatched;
      } catch (error) {
        recover(); await service.stop();
        // Keep the underlying identifier (never its message) so operators can see why start failed.
        const cause = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code) ? error.code : error?.name ?? 'unknown';
        // v2: report the failed boot so the Worker ends this generation now
        // instead of waiting out the boot deadline. Best effort; the deadline
        // still covers a runtime that cannot reach the Worker.
        if (v2Mode && bootIdentity) await control.request('abandon', { identity: bootIdentity, code: String(cause).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'unknown' }).catch(() => {});
        throw Object.assign(new Error('SERVICE_RECOVERY_REQUIRED'), { code: error.code === 'NATIVE_COMPATIBILITY_GATE_BLOCKED' ? error.code : 'SERVICE_RECOVERY_REQUIRED', causeCode: String(cause).slice(0, 64) });
      }
    },
    async observe(attemptId = undefined) {
      await router?.flush();
      const cursor = supervisor && await journal.get(supervisor.bridge.cursor);
      if (attemptId !== undefined) {
        const known = [...(supervisor ? await supervisor.bridge.families() : []),
          ...(taskSupervisor ? await taskSupervisor.bridge.families() : [])];
        if (!known.some(row => row.attemptId === attemptId)) fail('UNKNOWN_ATTEMPT');
        return adapter.requireRun(attemptId);
      }
      const latest = cursor?.attemptId ?? (supervisor && (await supervisor.bridge.families()).at(-1)?.attemptId);
      return latest ? adapter.requireRun(latest) : null;
    },
    async maintain() {
      if (phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
      await router.flush();
      // Both lanes drive their own maintain/admission cycle each tick. The
      // service's own return value stays the coordinator lane's dispatch result,
      // exactly as before -- callers that only know the single-lane contract
      // (existing tests, the coordinator's own claim/reply path) are unaffected.
      await supervisor.maintain();
      if (taskSupervisor) await taskSupervisor.maintain();
      const result = await admit();
      if (taskSupervisor) await admitTask();
      if (v2Mode) {
        try { await settleV2(supervisor); await settleV2(taskSupervisor); }
        catch (error) { recover(); throw error; }
      }
      return result;
    },
    /** V8 (ARCHITECTURE_V2 A3): both lanes idle for the grace period, then the
     * coordinator supervisor's existing drain asks the Worker to prepare and
     * commit sleep. The Worker's live-current-generation predicate decides;
     * a denial fences this executor (supervisor recovery), never retries. */
    async sleep(checkpoint) {
      if (!v2Mode) fail('SLEEP_DENIED');
      if (phase !== 'running') fail('SERVICE_RECOVERY_REQUIRED');
      for (const sup of [supervisor, taskSupervisor].filter(Boolean)) {
        const families = await sup.bridge.families();
        const cursor = await journal.get(sup.bridge.cursor);
        if (cursor && cursor.phase !== 'complete' || families.some(row => row.phase !== 'complete') ||
            sup.idleSince === null || now() - sup.idleSince < V2_IDLE_GRACE_MS) fail('SLEEP_DENIED');
      }
      // Stop the task lane's own timer so it cannot heartbeat into the commit.
      if (taskSupervisor) await taskSupervisor.quiesce();
      v2SleepAllowed = true;
      try { await supervisor.drain(checkpoint); }
      finally { v2SleepAllowed = false; }
      return { sleeping: supervisor.phase === 'sleeping' };
    },
    stop() {
      return stopping ??= (async () => {
        phase = 'recovery';
        questions?.close();
        if (questionNotification) { transport?.off('notification', questionNotification); transport?.off('disconnect', recover); }
        supervisor?.disconnect(); taskSupervisor?.disconnect(); router?.close(); transport?.close();
        if (router) await router.tail;
        if (transport) {
          const exited = () => transport.child.exitCode !== null || transport.child.signalCode !== null;
          const wait = async () => { for (let i = 0; i < 100 && !exited(); i++) await new Promise(ok => setTimeout(ok, 25)); };
          await wait();
          if (!exited()) { transport.child.kill('SIGKILL'); await wait(); }
          if (!exited()) fail('NATIVE_STOP_UNCONFIRMED');
        }
        if (supervisor) { await supervisor.work; await supervisor.maintenance?.catch(() => {}); }
        if (taskSupervisor) { await taskSupervisor.work; await taskSupervisor.maintenance?.catch(() => {}); }
        await admission?.catch(() => {});
        await taskAdmission?.catch(() => {});
        if (ownsIntent) await journal.update('service', { phase: 'recovery', nativeStopped: true });
        phase = 'recovery';
        // Intentionally no complete/commit-sleep or activity release on shutdown.
        // Unknown effects and the durable state survive for explicit reconciliation.
      })();
    },
  };
  return service;
}
