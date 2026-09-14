import { describe, expect, it } from 'vitest';
import vectors from '../TEST_VECTORS/commands.json';
import { parseCommand } from '../src/core/control';
import { bot } from './helpers';
describe('versioned command schema', () => {
  it('contains all 10 valid command variants and 4 rejection fixtures', () => { expect(vectors.valid).toHaveLength(10); expect(vectors.invalid).toHaveLength(4); });
  it.each(vectors.valid)('accepts $type fixture', (command) => { expect(parseCommand(command)).toEqual(command); });
  it.each(vectors.invalid)('rejects invalid contract %#', ({ command, expected_error }) => { expect(() => parseCommand(command)).toThrowError(expect.objectContaining({ code: expected_error })); });
  it('requires explicit lock release consent for stopped-run recovery, not supplied shutdown proof', () => {
    const command=(payload:unknown)=>({schema_version:1,type:'run.recover',payload});
    const payload={run_id:bot,expected_attempt:1,release_resources:true};
    expect(parseCommand(command(payload))).toEqual(command(payload));
    for(const invalid of [{run_id:bot,expected_attempt:1},{...payload,release_resources:false},{...payload,expected_attempt:0},{...payload,executionStopped:true}]) {
      expect(()=>parseCommand(command(invalid))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
  });
  it('requires an exact stopped-effect decision and bounded reference, without accepting release or shutdown assertions', () => {
    const payload = {run_id:bot,effect_id:bot,expected_attempt:1,expected_request_digest:'digest-19',outcome:'confirmed',evidence_ref:'receipt:43'};
    const command = (payload:unknown) => ({schema_version:1,type:'effect.reconcile',payload});
    expect(parseCommand(command(payload))).toEqual(command(payload));
    for(const change of [{expected_attempt:0},{outcome:'dispatched'},{evidence_ref:''},{evidence_ref:'https://example.invalid/private'},
      {evidence_ref:'x'.repeat(129)},{expected_request_digest:''},{expected_request_digest:'x'.repeat(257)},
      {resources:['mail:17']},{executionStopped:true},{effect_id:'not-a-uuid'}]) {
      expect(() => parseCommand(command({...payload,...change}))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
  });
  it('bounds owner budget policies and requires a revision for one-run overrides', () => {
    const policy = { expected_revision: 0, enabled: true, monthly_cap_cents: 500, optional_routine_ids: [bot] };
    const set = (payload: unknown) => ({ schema_version: 1, type: 'budget.set', payload });
    expect(parseCommand(set(policy))).toEqual(set(policy));
    expect(() => parseCommand(set({ ...policy, optional_routine_ids: [] }))).not.toThrow();
    for (const payload of [{ ...policy, monthly_cap_cents: 0 }, { ...policy, monthly_cap_cents: 500.5 },
      { ...policy, monthly_cap_cents: 1000000001 }, { ...policy, optional_routine_ids: [bot, bot] },
      { ...policy, enabled: 'true' }, { ...policy, grant: true }]) {
      expect(() => parseCommand(set(payload))).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
    const override = (payload: unknown) => ({ schema_version: 1, type: 'budget.override', payload });
    expect(() => parseCommand(override({ run_id: bot, expected_revision: 1 }))).not.toThrow();
    for (const payload of [{ run_id: bot }, { run_id: bot, expected_revision: 0 }, { run_id: bot, expected_revision: 1, all: true }]) {
      expect(() => parseCommand(override(payload))).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
  });
  it('enforces UTF-8 byte limit independently of code-point length', () => {
    const message = (text: string) => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
    expect(() => parseCommand(message('😀'.repeat(8192)))).not.toThrow();
    expect(() => parseCommand(message('😀'.repeat(8193)))).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', status: 413 }));
    expect(() => parseCommand(message('x'.repeat(32768)))).not.toThrow();
  });
});
