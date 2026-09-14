import test from 'node:test';
import assert from 'node:assert/strict';
import register from '../.amp/plugins/clawbot-smoke.js';

test('Amp smoke uses the invoking thread, bounded OpenAI calls, and independently checks both fixtures', async () => {
  let tool;
  const calls = [];
  const answers = [
    { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta', enabled: true, maySend: false },
    { cron: '', timezone: 'Asia/Jakarta', enabled: false, maySend: false },
  ];
  register({ registerTool: value => { tool = value; }, ai: { generate: async request => { calls.push(request); return answers[calls.length - 1]; } } });
  const result = JSON.parse((await tool.execute({}, { thread: { id: 'test-thread' } }))[0].text);
  assert.equal(result.passed, true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.threadID, 'test-thread');
    assert.equal(call.model, 'openai/gpt-5.6-sol');
    assert.equal(call.maxTokens, 256);
    assert.equal('tools' in call, false);
  }
  answers[1] = { ...answers[1], cron: '0 9 * * 5', enabled: true, maySend: true };
  calls.length = 0;
  const wrong = JSON.parse((await tool.execute({}, { thread: { id: 'test-thread' } }))[0].text);
  assert.equal(wrong.passed, false);
  assert.equal(wrong.checks[0].passed, true);
  assert.equal(wrong.checks[1].passed, false);
});

test('Amp model failure is redacted and never retried or replaced with another provider', async () => {
  let tool, calls = 0;
  register({ registerTool: value => { tool = value; }, ai: { generate: async () => { calls++; throw new Error('secret-canary'); } } });
  const output = (await tool.execute({}, { thread: { id: 'test-thread' } }))[0].text;
  const result = JSON.parse(output);
  assert.equal(calls, 1);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].outcome, 'unknown');
  assert.doesNotMatch(output, /secret-canary/);
});
