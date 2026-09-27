import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

// V4b (ARCHITECTURE_V2 A4, docs/AGENT_MODEL.md "one reserved interactive model
// turn plus at most one background model turn installation-wide"): the claim
// lane that actually executes a coordinator task run. Before this row a
// started task sat 'queued' forever -- nextClaimableRun() only ever admitted
// role='coordinator' runs (see the V4 TODO gap note and AGENTS.md trap #6).
//
// This exercises the runtime wiring with a scripted fake control/native
// backend, mirroring tests/runtime-execution-families.mjs's pattern, rather
// than the real Worker/Codex app-server (no live model calls; see the task
// brief). The fake backend models exactly the two-lane capacity and wake
// contract the real ControlCore/LifecycleCore now implement (proven against
// the real core in tests/task-tools.test.ts's "claim() background task lane
// (V4b)" describe block): one coordinator run, at most one background task
// run active at a time, and a coordinator wake enqueued on task settlement.

function createBackend() {
  let coordinator = { id: 'coord-1', status: 'queued', attempt: 0 };
  let task = null;
  const events = [];
  return {
    startTask(title, brief) {
      task = { id: 'task-1', parent_run_id: coordinator.id, title, brief, status: 'queued', attempt: 0 };
      return task.id;
    },
    claim(lane) {
      if (lane === 'background') {
        if (!task || task.status !== 'queued') return null;
        task.attempt += 1; task.status = 'claimed';
        return { submission_key: `${task.id}:${task.attempt}`,
          run: { id: task.id, current_attempt: task.attempt, persona_id: 'bot', role: 'background',
            parent_run_id: task.parent_run_id, title: task.title,
            // Isolated per-task context snapshot: brief as instruction, no shared
            // coordinator conversation history, `coordinator_task` marker set --
            // exactly what src/core/control.ts taskStart() stamps in.
            context_json: JSON.stringify({ instruction: task.brief, coordinator_task: true,
              persona: { id: 'bot', body: { tool_policy_ids: [] } }, room_id: null }) } };
      }
      if (coordinator.status !== 'queued') return null;
      coordinator.attempt += 1; coordinator.status = 'claimed';
      return { submission_key: `${coordinator.id}:${coordinator.attempt}`,
        run: { id: coordinator.id, current_attempt: coordinator.attempt, persona_id: 'bot', role: 'coordinator',
          parent_run_id: null, title: null,
          context_json: JSON.stringify({ instruction: 'Coordinator turn', persona: { id: 'bot', body: { tool_policy_ids: [] } } }) } };
    },
    complete(runId, result) {
      if (task && runId === task.id) {
        task.status = result.status;
        // src/core/lifecycle.ts complete() -> ControlCore.enqueueTaskEvent(): a
        // settled coordinator task appends task.event and wakes the coordinator.
        events.push({ type: 'task.event', task_run_id: task.id, status: result.status, title: task.title });
        coordinator = { id: 'coord-2', status: 'queued', attempt: 0 };
      } else if (runId === coordinator.id) {
        coordinator.status = result.status;
      }
    },
    events: () => events,
    coordinatorId: () => coordinator.id,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-task-lane-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory);
  const backend = createBackend();
  const identity = { epoch: 3, boot_id: 'boot-task-lane' };
  const submissions = [];
  const makeBridge = lane => new ExecutionBridge({
    journal, identity, installationId: 'task-lane-test', lane,
    personas: { bot: { agentId: 'assistant', model: 'synthetic', allowedTools: ['hehebot_send_message'] } },
    native: {
      admissionReadiness: () => ({ allowed: true }),
      submit: async input => { submissions.push(input); return { status: 'running', nativeRunId: `native-${lane}-${submissions.length}` }; },
    },
    control: { request: async (type, payload) => {
      if (type === 'claim') return backend.claim(lane);
      if (type === 'submitted') return {};
      if (type === 'complete') { backend.complete(payload.run_id, payload.result); return {}; }
      return {};
    } },
  });
  return { journal, backend, identity, submissions,
    coordinatorBridge: makeBridge('coordinator'), taskBridge: makeBridge('background') };
}

test('coordinator start_task is claimed on the background lane in its own thread, settles, and wakes the coordinator', async t => {
  const f = await fixture(t);
  // 1. The coordinator claims and runs its own turn (this is where, in the
  // real runtime, hehebot_start_task -> task.start would be called as a tool
  // during this turn; the fake backend models the resulting admitted task
  // directly, since no live model call is made in this test).
  const coordinatorClaim = await f.coordinatorBridge.claimNext();
  assert.equal(coordinatorClaim.phase, 'running');
  assert.equal(coordinatorClaim.claim.run.id, 'coord-1');
  const taskId = f.backend.startTask('Research hotels', 'Find three hotel options for the trip.');

  // 2. The background lane -- a distinct ExecutionBridge with its own journal
  // cursor -- claims the task independently of the still-running coordinator.
  assert.notEqual(f.coordinatorBridge.cursor, f.taskBridge.cursor);
  const taskClaim = await f.taskBridge.claimNext();
  assert.equal(taskClaim.phase, 'running');
  assert.equal(taskClaim.claim.run.id, taskId);
  assert.equal(taskClaim.claim.run.role, 'background');
  assert.equal(taskClaim.claim.run.parent_run_id, 'coord-1');

  // 3. Isolated context and isolated native thread: the task's turn input is
  // never the coordinator's scope, carries the brief (not the coordinator's
  // instruction), and gets task-executor guidance rather than coordinator
  // guidance.
  const [coordinatorInput, taskInput] = f.submissions;
  assert.notEqual(taskInput.scopeId, coordinatorInput.scopeId);
  assert.notEqual(taskInput.attemptId, coordinatorInput.attemptId);
  const taskMessage = JSON.parse(taskInput.message);
  assert.equal(taskMessage.instruction, 'Find three hotel options for the trip.');
  assert.ok(taskMessage.task_guidance.includes('task executor'));
  assert.ok(taskMessage.task_guidance.includes('hehebot_send_message'));
  assert.equal(taskMessage.coordinator_guidance, undefined);
  const coordinatorMessage = JSON.parse(coordinatorInput.message);
  assert.equal(coordinatorMessage.task_guidance, undefined);

  // 4. A second task claim attempt is refused while the first is still active
  // (capacity: at most one background task run active installation-wide) --
  // modeled here by the backend only ever admitting one `task` at a time,
  // matching claim()'s real capacity gate proven in tests/task-tools.test.ts.
  assert.equal(await f.taskBridge.claimNext().then(row => row.phase), 'running'); // still the same in-flight claim, no re-claim

  // 5. The task settles; this appends a task.event and wakes the coordinator
  // (src/core/lifecycle.ts complete() -> ControlCore.enqueueTaskEvent()).
  await f.taskBridge.complete({ attemptId: taskClaim.attemptId, nativeRunId: taskClaim.nativeRunId,
    rootSettled: true, toolsSettled: true, childrenSettled: true, effectsSettled: true, outputCommitted: true,
    result: { status: 'completed', text: 'Found three great hotels.' } });
  assert.deepEqual(f.backend.events(), [{ type: 'task.event', task_run_id: taskId, status: 'completed', title: 'Research hotels' }]);
  assert.equal(f.backend.coordinatorId(), 'coord-2');

  // 6. The coordinator releases its prior turn and claims the wake -- a fresh
  // coordinator run, never the task's.
  await f.coordinatorBridge.releaseCoordinator({ attemptId: coordinatorClaim.attemptId, nativeRunId: coordinatorClaim.nativeRunId,
    rootSettled: true, nativeOutcome: 'completed' });
  const wake = await f.coordinatorBridge.claimNext();
  assert.equal(wake.phase, 'running');
  assert.equal(wake.claim.run.id, 'coord-2');
  assert.notEqual(wake.claim.run.id, taskId);
});
