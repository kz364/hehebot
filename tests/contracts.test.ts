import { describe, expect, it } from 'vitest';
import vectors from '../TEST_VECTORS/commands.json';
import { parseCommand } from '../src/core/control';
import { bot } from './helpers';
describe('versioned command schema', () => {
  it('contains all 10 valid command variants and 4 rejection fixtures', () => { expect(vectors.valid).toHaveLength(10); expect(vectors.invalid).toHaveLength(4); });
  it.each(vectors.valid)('accepts $type fixture', (command) => { expect(parseCommand(command)).toEqual(command); });
  it.each(vectors.invalid)('rejects invalid contract %#', ({ command, expected_error }) => { expect(() => parseCommand(command)).toThrowError(expect.objectContaining({ code: expected_error })); });
  it('enforces UTF-8 byte limit independently of code-point length', () => {
    const message = (text: string) => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
    expect(() => parseCommand(message('😀'.repeat(8192)))).not.toThrow();
    expect(() => parseCommand(message('😀'.repeat(8193)))).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', status: 413 }));
    expect(() => parseCommand(message('x'.repeat(32768)))).not.toThrow();
  });
});
