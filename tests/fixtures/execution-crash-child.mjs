import { ExecutionBridge } from '../../runtime/execution-bridge.mjs';
import { FileJournal } from '../../runtime/file-journal.mjs';

const [directory, endpoint, action, boundary] = process.argv.slice(2);
const identity = { epoch: 17, boot_id: 'crash-regression-boot' };

function notify(message) {
  if (process.send) process.send(message);
}

async function request(type, payload) {
  const response = await fetch(`${endpoint}/${type}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

class BarrierJournal extends FileJournal {
  async putIfAbsent(id, row) {
    const result = await super.putIfAbsent(id, row);
    if (boundary === 'claim_unknown' && row.phase === 'claim_unknown') {
      notify({ type: 'boundary', boundary });
      await new Promise(() => {});
    }
    return result;
  }
}

const journal = new BarrierJournal(directory);
const bridge = new ExecutionBridge({
  journal, identity, installationId: 'crash-regression-installation',
  personas: { 'persona-crash': { agentId: 'crash-agent', model: 'test-model' } },
  control: { request },
  native: {
    admissionReadiness: () => ({ allowed: true }),
    submit: input => request('native', input),
  },
});

async function main() {
  if (action === 'run') {
    const row = await bridge.claimNext();
    notify({ type: 'result', row });
  } else if (action === 'recover') {
    const before = await bridge.claimNext();
    const after = before.phase === 'submitted_unknown'
      ? await bridge.acknowledgeSubmission()
      : before;
    notify({ type: 'result', before, after });
  } else {
    throw new Error('UNKNOWN_ACTION');
  }
}

main().catch(error => {
  notify({ type: 'error', message: error.message, code: error.code });
  process.exitCode = 1;
});
