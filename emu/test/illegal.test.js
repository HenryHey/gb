import { describe, expect, test } from 'bun:test';
import { hexOp, isa, makeCpu, tick } from './harness.js';

describe('illegal opcodes', () => {
  for (const [key, op] of Object.entries(isa.unprefixed)) {
    if (!op.mnemonic.startsWith('ILLEGAL')) continue;
    const opcode = parseInt(key, 16);
    test(`${hexOp(opcode)} throws`, () => {
      const cpu = makeCpu({ bytes: [opcode] });
      expect(() => tick(cpu)).toThrow();
    });
  }
});
